import { randomBytes, timingSafeEqual } from 'node:crypto';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { z } from 'zod';

const inputSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('tap'), x: z.number().nonnegative(), y: z.number().nonnegative() }),
  z.object({ kind: z.literal('type'), value: z.string().max(8192) }),
  z.object({ kind: z.literal('press'), key: z.string().min(1).max(80) }),
  z.object({ kind: z.literal('scroll'), direction: z.enum(['up', 'down', 'left', 'right']) }),
]);
export type HumanInput = z.infer<typeof inputSchema>;
export type ViewerOptions = {
  port: number;
  allowTakeover: boolean;
  frame: () => Promise<Buffer>;
  owner: () => 'agent' | 'human';
  change: (owner: 'agent' | 'human') => Promise<void>;
  input: (input: HumanInput) => Promise<void>;
};

async function body(request: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > 16384) throw new Error('Viewer input too large');
    chunks.push(Buffer.from(chunk));
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

/** No desktop input exists in the browser until an authenticated, opted-in takeover. */
const PAGE = `<!doctype html><meta charset="utf-8"><title>Bugpatrol private desktop</title>
<style>body{background:#111;color:#eee;font:16px system-ui;margin:20px}img{max-width:100%;display:block}button,input{font:inherit;margin:8px}</style>
<p id="state">Connecting to private desktop…</p><button id="control" hidden>Take over</button>
<form id="typing" hidden><input id="text" autocomplete="off"><button>Type</button></form><img id="frame" alt="Private app window">
<script>
const token=location.hash.slice(1); history.replaceState(null,'',location.pathname);
const headers={Authorization:'Bearer '+token,'Content-Type':'application/json'};
let human=false, allowed=false, busy=false;
async function call(path,data){const r=await fetch(path,{method:data?'POST':'GET',headers,body:data?JSON.stringify(data):undefined});if(!r.ok)throw Error(await r.text());return r;}
async function poll(){try{const state=await(await call('/state')).json();human=state.owner==='human';allowed=state.allowTakeover;
document.querySelector('#state').textContent=human?'You have control. Agent input is paused.':'Agent has control. Viewer is read-only.';
document.querySelector('#control').hidden=!allowed;document.querySelector('#control').textContent=human?'Return to agent':'Take over';document.querySelector('#typing').hidden=!human;
const blob=await(await call('/frame')).blob();const url=URL.createObjectURL(blob), img=document.querySelector('#frame');img.onload=()=>URL.revokeObjectURL(url);img.src=url;
}catch(e){document.querySelector('#state').textContent=e.message;}setTimeout(poll,1000);}
async function input(data){if(!human||busy)return;busy=true;try{await call('/input',data);}catch(e){document.querySelector('#state').textContent=e.message;}finally{busy=false;}}
document.querySelector('#control').onclick=async()=>{await call('/control',{owner:human?'agent':'human'});};
document.querySelector('#frame').onclick=e=>{if(!human)return;const img=e.currentTarget,r=img.getBoundingClientRect();input({kind:'tap',x:(e.clientX-r.left)*img.naturalWidth/r.width,y:(e.clientY-r.top)*img.naturalHeight/r.height});};
document.querySelector('#typing').onsubmit=e=>{e.preventDefault();input({kind:'type',value:document.querySelector('#text').value});};
document.querySelector('#frame').onwheel=e=>{if(!human)return;e.preventDefault();input({kind:'scroll',direction:e.deltaY>0?'down':'up'});};
document.addEventListener('keydown',e=>{if(!human||e.target.tagName==='INPUT'||e.ctrlKey||e.altKey||e.metaKey)return;e.preventDefault();input({kind:'press',key:e.key});});poll();
</script>`;

export async function startViewer(options: ViewerOptions): Promise<{ url: string; close: () => Promise<void> }> {
  const token = randomBytes(32).toString('hex');
  let origin = '';
  const respond = (response: ServerResponse, status: number, data: string | Buffer, type = 'text/plain') => {
    response.writeHead(status, {
      'Content-Type': type,
      'Cache-Control': 'no-store',
      'Content-Security-Policy':
        "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src blob:; connect-src 'self'; frame-ancestors 'none'",
      'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'no-referrer',
    });
    response.end(data);
  };
  const server = createServer(async (request, response) => {
    try {
      if (request.headers.host !== new URL(origin).host) {
        respond(response, 403, 'Wrong viewer host');
        return;
      }
      if (request.method === 'GET' && request.url === '/') {
        respond(response, 200, PAGE, 'text/html');
        return;
      }
      const supplied = Buffer.from(request.headers.authorization ?? '');
      const expected = Buffer.from(`Bearer ${token}`);
      if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) {
        respond(response, 401, 'Viewer token required');
        return;
      }
      if (request.method === 'GET' && request.url === '/state') {
        respond(
          response,
          200,
          JSON.stringify({ owner: options.owner(), allowTakeover: options.allowTakeover }),
          'application/json',
        );
        return;
      }
      if (request.method === 'GET' && request.url === '/frame') {
        respond(response, 200, await options.frame(), 'image/png');
        return;
      }
      if (request.method !== 'POST') {
        respond(response, 404, 'Not found');
        return;
      }
      if (!options.allowTakeover || request.headers.origin !== origin) {
        respond(response, 403, 'Viewer input disabled or wrong origin');
        return;
      }
      if (request.url === '/control') {
        const input = z.object({ owner: z.enum(['agent', 'human']) }).parse(await body(request));
        await options.change(input.owner);
      } else if (request.url === '/input') {
        await options.input(inputSchema.parse(await body(request)));
      } else {
        respond(response, 404, 'Not found');
        return;
      }
      respond(response, 200, '{}', 'application/json');
    } catch (error) {
      respond(response, 409, error instanceof Error ? error.message : 'Viewer operation failed');
    }
  });
  server.requestTimeout = 10000;
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(options.port, '127.0.0.1', resolve);
  });
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Viewer did not bind a TCP port');
  origin = `http://127.0.0.1:${address.port}`;
  return {
    url: `${origin}/#${token}`,
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
        server.closeAllConnections();
      }),
  };
}
