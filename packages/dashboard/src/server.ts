import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { createReadStream, existsSync, realpathSync, statSync, watch, type FSWatcher } from 'node:fs';
import { extname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { paths } from '@autoqa/core';
import { ProjectReader } from './project.js';
import { buildGraph } from './graph.js';

export type DashboardOptions = {
  root: string;
  port?: number;
  /**
   * Loopback by default and deliberately so: screenshots are of a real
   * application and routinely contain real data. Binding 0.0.0.0 would put
   * them on the network of whatever coffee shop the laptop is in.
   */
  host?: string;
  onReady?: (url: string) => void;
};

export type Dashboard = { url: string; close(): Promise<void> };

const UI_DIR = resolve(fileURLToPath(new URL('.', import.meta.url)), '..', 'src', 'ui');

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.json': 'application/json; charset=utf-8',
};

export async function startDashboard(options: DashboardOptions): Promise<Dashboard> {
  const root = resolve(options.root);
  const host = options.host ?? '127.0.0.1';
  const reader = new ProjectReader(root);
  const clients = new Set<ServerResponse>();

  const server = createServer((req, res) => {
    handle(req, res, { root, reader, clients }).catch((error) => {
      send(res, 500, { 'content-type': 'application/json' }, JSON.stringify({ error: String(error) }));
    });
  });

  const watcher = watchProject(root, () => broadcast(clients, 'changed', { at: Date.now() }));

  const port = await listen(server, options.port ?? 4311, host);
  const url = `http://${host}:${port}`;
  options.onReady?.(url);

  return {
    url,
    async close() {
      watcher?.close();
      for (const client of clients) client.end();
      await new Promise<void>((done) => server.close(() => done()));
    },
  };
}

async function handle(
  req: IncomingMessage,
  res: ServerResponse,
  ctx: { root: string; reader: ProjectReader; clients: Set<ServerResponse> },
): Promise<void> {
  const url = new URL(req.url ?? '/', 'http://localhost');
  const path = url.pathname;

  if (path === '/api/events') return streamEvents(res, ctx.clients);

  if (path === '/api/state') {
    const runs = ctx.reader.listRuns();
    return json(res, {
      root: ctx.root,
      hasProject: ctx.reader.hasProject(),
      hasConfig: existsSync(paths.config(ctx.root)),
      hasAppModel: ctx.reader.readAppModel() !== undefined,
      runs,
      live: ctx.reader.readLive() ?? null,
      intents: ctx.reader.readIntents().length,
    });
  }

  if (path === '/api/graph') {
    const requested = url.searchParams.get('run');
    const run = requested ? ctx.reader.readRun(requested) : ctx.reader.latestRun();
    return json(res, buildGraph(ctx.reader.readAppModel(), run, requested ? undefined : ctx.reader.readLive()));
  }

  if (path.startsWith('/api/runs/')) {
    const runId = decodeURIComponent(path.slice('/api/runs/'.length));
    const record = ctx.reader.readRun(runId);
    if (!record) return json(res, { error: 'no such run' }, 404);
    return json(res, {
      run: record.run,
      findings: record.findings,
      trace: record.trace ?? null,
      dir: record.dir,
    });
  }

  if (path === '/api/artifact') {
    const requested = url.searchParams.get('path');
    if (!requested) return json(res, { error: 'path is required' }, 400);
    return serveArtifact(res, ctx.root, requested);
  }

  return serveUi(res, path);
}

/**
 * Serves a capture artifact, confined to the project's `.autoqa` directory.
 *
 * This endpoint takes a filesystem path from a query string, which is exactly
 * the shape of a path-traversal bug. The guard resolves the path first and then
 * checks containment, so `../../../.ssh/id_rsa`, an absolute path, and a
 * symlink pointing outside the tree are all rejected on the resolved form
 * rather than by pattern-matching the input.
 */
export function resolveArtifactPath(root: string, requested: string): string | undefined {
  const candidate = resolve(root, requested);
  if (!existsSync(candidate)) return undefined;

  // resolve() only normalises `..` lexically -- it does not follow symlinks, so
  // a link planted inside .autoqa would otherwise pass containment and then
  // read whatever it points at. Both sides are realpath'd so the check is on
  // the actual file, not on the name used to reach it.
  let real: string;
  let allowed: string;
  try {
    real = realpathSync(candidate);
    allowed = realpathSync(paths.dir(root));
  } catch {
    return undefined;
  }

  const rel = relative(allowed, real);
  if (rel === '' || rel.startsWith('..') || rel.startsWith(`..${sep}`)) return undefined;

  const stat = statSync(real);
  if (!stat.isFile()) return undefined;

  // Only artifact types the UI actually renders. A traversal that somehow
  // landed on a readable file still cannot exfiltrate a .env or a key.
  if (!['.png', '.jpg', '.jpeg', '.webp', '.json'].includes(extname(real).toLowerCase())) return undefined;

  return real;
}

function serveArtifact(res: ServerResponse, root: string, requested: string): void {
  const file = resolveArtifactPath(root, requested);
  if (!file) return json(res, { error: 'not found' }, 404);

  res.writeHead(200, {
    'content-type': MIME[extname(file).toLowerCase()] ?? 'application/octet-stream',
    'cache-control': 'no-cache',
  });
  createReadStream(file).pipe(res);
}

function serveUi(res: ServerResponse, path: string): void {
  const name = path === '/' ? 'index.html' : path.replace(/^\//, '');
  const file = resolve(UI_DIR, name);
  if (!file.startsWith(UI_DIR) || !existsSync(file) || !statSync(file).isFile()) {
    // Unknown paths fall through to the app shell so client-side routing works.
    return serveUi(res, '/');
  }
  res.writeHead(200, { 'content-type': MIME[extname(file)] ?? 'text/plain', 'cache-control': 'no-cache' });
  createReadStream(file).pipe(res);
}

/**
 * Server-sent events rather than a websocket: the dashboard only ever pushes
 * "something changed, re-fetch", which is one direction and a handful of bytes.
 * A websocket would add a dependency and a handshake for no gain.
 */
function streamEvents(res: ServerResponse, clients: Set<ServerResponse>): void {
  res.writeHead(200, {
    'content-type': 'text/event-stream',
    'cache-control': 'no-cache',
    connection: 'keep-alive',
  });
  res.write('retry: 2000\n\n');
  clients.add(res);

  const keepAlive = setInterval(() => res.write(': ping\n\n'), 25_000);
  res.on('close', () => {
    clearInterval(keepAlive);
    clients.delete(res);
  });
}

function broadcast(clients: Set<ServerResponse>, event: string, data: unknown): void {
  const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const client of clients) client.write(payload);
}

/**
 * Watches `.autoqa/` for run output. Coalesced, because a single run writes
 * several files in quick succession and a client that re-fetches per file
 * would hammer the server for one logical change.
 */
function watchProject(root: string, onChange: () => void): FSWatcher | undefined {
  const dir = paths.dir(root);
  if (!existsSync(dir)) return undefined;

  let timer: NodeJS.Timeout | undefined;
  try {
    return watch(dir, { recursive: true }, () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(onChange, 250);
    });
  } catch {
    // Recursive watch is not available on every platform; the UI also polls.
    return undefined;
  }
}

function json(res: ServerResponse, body: unknown, status = 200): void {
  send(res, status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-cache' }, JSON.stringify(body));
}

function send(res: ServerResponse, status: number, headers: Record<string, string>, body: string): void {
  res.writeHead(status, headers);
  res.end(body);
}

function listen(server: ReturnType<typeof createServer>, preferred: number, host: string): Promise<number> {
  return new Promise((resolvePort, reject) => {
    const attempt = (port: number, remaining: number): void => {
      server.once('error', (error: NodeJS.ErrnoException) => {
        // A stale dashboard on the default port should not be a hard failure.
        if (error.code === 'EADDRINUSE' && remaining > 0) return attempt(port + 1, remaining - 1);
        reject(error);
      });
      server.listen(port, host, () => resolvePort((server.address() as { port: number }).port));
    };
    attempt(preferred, 20);
  });
}

export { join as joinPath };
