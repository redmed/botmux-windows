/** Host process rules shared by executable discovery and the PTY backend.
 * Keep Windows command parsing here: callers pass an executable and argv,
 * never a shell program. POSIX spawning retains its existing argv semantics. */
import { accessSync, constants, statSync } from 'node:fs';
import { execFileSync, spawnSync } from 'node:child_process';
import { delimiter, isAbsolute, join, win32 } from 'node:path';

export function normalizeWindowsPath(value: string): string {
  const match = /^\/([a-z])(?:\/(.*))?$/i.exec(value);
  return match ? `${match[1]!.toUpperCase()}:\\${(match[2] ?? '').replaceAll('/', '\\')}` : value;
}

function envValue(env: NodeJS.ProcessEnv, name: string): string | undefined {
  const key = Object.keys(env).find(key => key.toUpperCase() === name);
  return key === undefined ? undefined : env[key];
}

export function resolveHostExecutable(
  command: string | undefined,
  env: NodeJS.ProcessEnv = process.env,
  platform: NodeJS.Platform = process.platform,
): string | null {
  if (!command) return null;
  const windows = platform === 'win32';
  const path = windows ? normalizeWindowsPath(command) : command;
  const extensions = windows
    ? (envValue(env, 'PATHEXT') || '.COM;.EXE;.BAT;.CMD').split(';').filter(ext => /^\.[a-z0-9]+$/i.test(ext))
    : [];
  const names = windows && !win32.extname(path) ? extensions.map(ext => path + ext) : [path];
  const absolute = windows ? win32.isAbsolute(path) : isAbsolute(path);
  const dirs = absolute ? [''] : (windows ? envValue(env, 'PATH') ?? '' : env.PATH ?? '')
    .split(windows ? ';' : delimiter).filter(Boolean).map(dir => dir.replace(/^"(.*)"$/, '$1'));
  for (const dir of dirs) {
    for (const name of names) {
      const candidate = dir ? (windows ? win32.join(dir, name) : join(dir, name)) : name;
      try {
        if (!statSync(candidate).isFile()) continue;
        accessSync(candidate, windows ? constants.F_OK : constants.X_OK);
        return candidate;
      } catch { /* try the next candidate */ }
    }
  }
  return null;
}

/** cmd.exe cannot represent arbitrary argv safely. Reject expansion characters
 * instead of silently expanding user text or executing a second command.
 * Native .exe applications have no such restriction and never pass via cmd. */
function quoteBatchArgument(value: string): string {
  if (/["%!\r\n\0]/.test(value)) {
    throw new Error('Batch launch cannot safely represent quotes, %, ! or line breaks; configure a native executable instead.');
  }
  return `"${value}"`;
}

export function prepareHostSpawn(
  command: string, args: string[], env: NodeJS.ProcessEnv = process.env,
  platform: NodeJS.Platform = process.platform,
): { command: string; args: string[] | string } {
  if (platform !== 'win32') return { command, args };
  const resolved = resolveHostExecutable(command, env, platform) ?? normalizeWindowsPath(command);
  if (!/\.(cmd|bat)$/i.test(resolved)) return { command: resolved, args };
  const shell = envValue(env, 'COMSPEC') || `${envValue(env, 'SYSTEMROOT') || 'C:\\Windows'}\\System32\\cmd.exe`;
  // node-pty accepts a raw Windows command line. An argv array would be quoted
  // a second time by libuv, breaking cmd's required outer pair of quotes.
  return { command: shell, args: `/d /s /v:off /c "${[resolved, ...args].map(quoteBatchArgument).join(' ')}"` };
}

/** Only used for a still-owned PTY. Callers clear the handle on exit and before
 * closing so a second close can never target a recycled process id. */
export function closeHostPty(child: { pid: number; kill(): void }, platform: NodeJS.Platform = process.platform): void {
  if (platform === 'win32' && Number.isSafeInteger(child.pid) && child.pid > 1) {
    // /T is essential: closing only cmd.exe leaves its CLI grandchildren alive.
    killWindowsProcessTree(child.pid);
  }
  try { child.kill(); } catch { /* ConPTY may already be detached. */ }
  disposeExitedHostPty(child, platform);
}

/** Caller must own the live child or have just attested a stale process. */
export function killWindowsProcessTree(pid: number): void {
  if (!Number.isSafeInteger(pid) || pid <= 1) return;
  spawnSync('taskkill.exe', ['/PID', String(pid), '/T', '/F'], {
    windowsHide: true, stdio: 'ignore', timeout: 5_000,
  });
}

/** PID-reuse check for RPC orphan recovery; never expose a general shell
 * interpolation surface. Only a validated decimal PID enters the command. */
export function windowsProcessCommandLine(pid: number): string | undefined {
  if (!Number.isSafeInteger(pid) || pid <= 1) return undefined;
  try {
    return execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command',
      `[Console]::OutputEncoding=[System.Text.UTF8Encoding]::new($false); (Get-CimInstance Win32_Process -Filter 'ProcessId = ${pid}').CommandLine`],
    {encoding: 'utf8', windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'], timeout: 5_000}).trim() || undefined;
  } catch { return undefined; }
}

/** Bundled ConPTY closes without node-pty's racy console-list helper, which
 * attempts AttachConsole after taskkill has already detached the console. */
export function hostPtyOptions(platform: NodeJS.Platform = process.platform): { useConptyDll?: boolean } {
  return platform === 'win32' ? { useConptyDll: true } : {};
}

// node-pty 1.1.0's Windows public kill() leaves the conout worker referenced
// when no final data event follows close. Keep this version-specific cleanup
// in the host adapter; the real Windows smoke asserts the verifier can exit.
const disposedPtys = new WeakSet<object>();
export function disposeExitedHostPty(child: object, platform: NodeJS.Platform = process.platform): void {
  if (platform !== 'win32' || disposedPtys.has(child)) return;
  disposedPtys.add(child);
  const internal = child as {
    _agent?: {
      _conoutSocketWorker?: { dispose(): void };
      inSocket?: { destroy(): void };
    };
  };
  internal._agent?._conoutSocketWorker?.dispose();
  internal._agent?.inSocket?.destroy();
}
