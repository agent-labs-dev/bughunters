import { randomBytes } from 'node:crypto';
import { access, mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { getDefaultEnvironment, StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

/** A separate X server and bus isolate focus; no user profile or backend env is inherited. */
export async function isolatedTransport(
  command: string,
  windowManager: string,
  width: number,
  height: number,
): Promise<{
  transport: StdioClientTransport;
  directory: string;
  remove: () => Promise<void>;
}> {
  if (process.platform !== 'linux') throw new Error('Cua desktop isolation currently requires Linux/Xvfb');
  const find = async (name: string): Promise<string> => {
    for (const prefix of ['/usr/lib', '/usr/libexec', '/usr/lib/at-spi2-core']) {
      const path = join(prefix, name);
      try {
        await access(path);
        return path;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      }
    }
    throw new Error(`Missing Linux prerequisite: ${name}`);
  };
  const bus = await find('at-spi-bus-launcher');
  const registry = await find('at-spi2-registryd');
  const directory = await mkdtemp(join(tmpdir(), 'bugpatrol-desktop-'));
  try {
    const home = join(directory, 'home');
    const runtime = join(directory, 'runtime');
    await mkdir(home, { mode: 0o700 });
    await mkdir(runtime, { mode: 0o700 });
    const env = {
      ...getDefaultEnvironment(),
      HOME: home,
      XDG_RUNTIME_DIR: runtime,
      XDG_CONFIG_HOME: join(home, 'config'),
      XDG_CACHE_HOME: join(home, 'cache'),
      XDG_DATA_HOME: join(home, 'data'),
      XDG_SESSION_TYPE: 'x11',
      GDK_BACKEND: 'x11',
      CUA_DRIVER_RS_ENABLE_WAYLAND: '0',
      GTK_USE_PORTAL: '0',
    };
    const transport = new StdioClientTransport({
      command: 'setsid',
      args: [
        'sh',
        '-c',
        'export XAUTHORITY="$1/auth"; xauth -f "$XAUTHORITY" add :0 . "$2" || exit 1; Xvfb -displayfd 3 -screen 0 "$3" -nolisten tcp -auth "$XAUTHORITY" 3>"$1/display" >"$1/xvfb.log" 2>&1 & xvfb=$!; n=0; while [ ! -s "$1/display" ]; do kill -0 "$xvfb" || { cat "$1/xvfb.log" >&2; exit 1; }; n=$((n+1)); [ "$n" -lt 100 ] || exit 1; sleep 0.05; done; export DISPLAY=":$(cat "$1/display")"; xauth -f "$XAUTHORITY" add "$DISPLAY" . "$2" || exit 1; shift 3; exec "$@"',
        'bugpatrol-xvfb',
        directory,
        randomBytes(32).toString('hex'),
        `${width}x${height}x24`,
        'dbus-run-session',
        '--',
        'sh',
        '-c',
        '"$1" --launch-immediately >/dev/null 2>&1 & shift; "$1" >/dev/null 2>&1 & shift; command -v "$1" >/dev/null || exit 127; "$1" --sm-disable >"$XDG_RUNTIME_DIR/wm.log" 2>&1 & wm=$!; sleep 0.2; kill -0 "$wm" || { cat "$XDG_RUNTIME_DIR/wm.log" >&2; exit 1; }; shift; exec "$@"',
        'bugpatrol-private',
        bus,
        registry,
        windowManager,
        command,
        'mcp',
        '--direct',
      ],
      env,
      stderr: 'pipe',
    });
    return { transport, directory, remove: () => rm(directory, { recursive: true, force: true }) };
  } catch (error) {
    await rm(directory, { recursive: true, force: true });
    throw error;
  }
}
