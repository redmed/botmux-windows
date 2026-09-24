import { afterEach, describe, expect, it, vi } from 'vitest';
import { normalizeWindowsPath, prepareHostSpawn, resolveHostExecutable, closeHostPty } from '../../src/host/runtime.js';
import * as fs from 'node:fs';
import * as cp from 'node:child_process';

vi.mock('node:fs', async original => ({ ...await original<typeof import('node:fs')>() }));
vi.mock('node:child_process', async original => ({ ...await original<typeof import('node:child_process')>() }));
afterEach(() => vi.restoreAllMocks());
function files(...paths: string[]) {
  const keys = paths.map(path => path.toLowerCase());
  vi.spyOn(fs, 'statSync').mockImplementation(((path: string) => {
    if (!keys.includes(String(path).replaceAll('/', '\\').toLowerCase())) throw new Error('ENOENT');
    return { isFile: () => true };
  }) as typeof fs.statSync);
  vi.spyOn(fs, 'accessSync').mockImplementation(() => {});
}

describe('Windows host executable resolution', () => {
  it('converts drive MSYS paths and leaves non-drive POSIX/UNC/native paths alone', () => {
    expect(normalizeWindowsPath('/c/Users/a/x')).toBe('C:\\Users\\a\\x');
    expect(normalizeWindowsPath('C:/Users/a/x')).toBe('C:/Users/a/x');
    expect(normalizeWindowsPath('/usr/bin/x')).toBe('/usr/bin/x');
    expect(normalizeWindowsPath('\\\\server\\share\\x')).toBe('\\\\server\\share\\x');
  });
  it('resolves extensionless shell output with fallback PATHEXT and spaces', () => {
    files('C:\\Users\\A Person\\traex.exe');
    expect(resolveHostExecutable('/c/Users/A Person/traex', { PATHEXT: '' }, 'win32')).toBe('C:\\Users\\A Person\\traex.EXE');
  });
  it('supports Windows env casing, quoted PATH, extension casing and precedence', () => {
    files('C:\\Tools with spaces\\cli.cmd', 'C:\\Other\\cli.exe');
    expect(resolveHostExecutable('cli', { Path: '"C:\\Tools with spaces";C:\\Other', PathExt: '.EXE;.CMD' }, 'win32')).toBe('C:\\Tools with spaces\\cli.CMD');
    expect(resolveHostExecutable('C:/Other/cli.eXe', {}, 'win32')).toBe('C:/Other/cli.eXe');
  });
  it('never accepts a directory or silently searches CWD with empty PATH', () => {
    vi.spyOn(fs, 'statSync').mockReturnValue({ isFile: () => false } as fs.Stats);
    expect(resolveHostExecutable('cli', { PATH: 'C:\\Tools' }, 'win32')).toBeNull();
    expect(resolveHostExecutable('cli', { PATH: '' }, 'win32')).toBeNull();
  });
});

describe('host process launch', () => {
  it('keeps native and POSIX argv intact including arbitrary prompts', () => {
    files('C:\\Tools\\cli.exe');
    const args = ['quotes " $() & % !', '中文', 'two\nlines'];
    expect(prepareHostSpawn('C:\\Tools\\cli.exe', args, {}, 'win32')).toEqual({ command: 'C:\\Tools\\cli.exe', args });
    expect(prepareHostSpawn('/bin/sh', args, {}, 'linux')).toEqual({ command: '/bin/sh', args });
  });
  it('quotes each batch argument and disables cmd autorun/delayed expansion', () => {
    files('C:\\Program Files\\pm2.cmd');
    expect(prepareHostSpawn('C:\\Program Files\\pm2.cmd', ['start', 'C:\\a b\\x.js', 'a&b'], {}, 'win32')).toEqual({
      command: 'C:\\Windows\\System32\\cmd.exe',
      args: '/d /s /v:off /c ""C:\\Program Files\\pm2.cmd" "start" "C:\\a b\\x.js" "a&b""',
    });
  });
  it.each(['%PATH%', 'a"&whoami', '!x!', 'a\nb'])('fails closed for unsafe batch arg %j', value => {
    expect(() => prepareHostSpawn('C:\\cli.cmd', [value], {}, 'win32')).toThrow('Batch launch');
  });
  it('terminates the owned Windows tree and tolerates a detached console', () => {
    const spawn = vi.spyOn(cp, 'spawnSync').mockReturnValue({ status: 128 } as any);
    expect(() => closeHostPty({ pid: 1234, kill: () => { throw new Error('AttachConsole failed'); } }, 'win32')).not.toThrow();
    expect(spawn).toHaveBeenCalledWith('taskkill.exe', ['/PID', '1234', '/T', '/F'], expect.objectContaining({ windowsHide: true }));
  });
});
