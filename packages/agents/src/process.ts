import { spawn } from 'node:child_process';

export type ProcessOptions = {
  cwd: string;
  env?: NodeJS.ProcessEnv;
  signal?: AbortSignal;
  timeoutMs: number;
  input?: string;
  maxBytes?: number;
  onOutput?: (text: string) => void;
};

/** Own the whole process group and drain its pipes before reporting completion. */
export async function runProcess(command: string, args: string[], options: ProcessOptions): Promise<{
  code: number | null; stdout: string; stderr: string; timedOut: boolean; cancelled: boolean; overflow: boolean;
}> {
  options.signal?.throwIfAborted();
  const child = spawn(command, args, { cwd: options.cwd, env: options.env, detached: true, stdio: ['pipe', 'pipe', 'pipe'] });
  let stdout = ''; let stderr = ''; let bytes = 0;
  let timedOut = false; let cancelled = false; let overflow = false;
  let escalation: ReturnType<typeof setTimeout> | undefined;
  const kill = (signal: NodeJS.Signals) => {
    if (!child.pid) return;
    try { process.kill(-child.pid, signal); }
    catch { child.kill(signal); }
  };
  const stop = () => {
    if (escalation) return;
    kill('SIGTERM');
    escalation = setTimeout(() => kill('SIGKILL'), 1_000);
  };
  const abort = () => { cancelled = true; stop(); };
  options.signal?.addEventListener('abort', abort, { once: true });
  if (options.signal?.aborted) abort();
  const timer = setTimeout(() => { timedOut = true; stop(); }, options.timeoutMs);
  const append = (chunk: Buffer, error: boolean) => {
    bytes += chunk.length;
    if (bytes > (options.maxBytes ?? 4 * 1024 * 1024)) { overflow = true; stop(); return; }
    const text = chunk.toString();
    if (error) stderr += text; else stdout += text;
    options.onOutput?.(text);
  };
  child.stdout.on('data', (chunk: Buffer) => append(chunk, false));
  child.stderr.on('data', (chunk: Buffer) => append(chunk, true));
  child.stdin.on('error', () => {}); // An early process exit may close stdin before the prompt is consumed.
  child.stdin.end(options.input);
  try {
    const code = await new Promise<number | null>((resolve, reject) => {
      child.once('error', reject); child.once('close', resolve);
    });
    return { code, stdout, stderr, timedOut, cancelled, overflow };
  } finally {
    clearTimeout(timer); clearTimeout(escalation);
    options.signal?.removeEventListener('abort', abort);
    // A shell can exit before its descendants. Do not leave detached work behind.
    kill('SIGKILL');
  }
}
