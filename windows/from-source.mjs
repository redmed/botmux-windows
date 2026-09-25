#!/usr/bin/env node
/** Native Windows source -> frozen dependencies -> upstream build -> verified install. */
import { existsSync, lstatSync, readFileSync, statSync } from 'node:fs';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const release = JSON.parse(readFileSync(join(root, 'windows/release.json'), 'utf8'));
const args = process.argv.slice(2);
let bunArg, installRoot, buildOnly = false, checkOnly = false;
try {
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--build-only') buildOnly = true;
    else if (arg === '--check') checkOnly = true;
    else if (arg === '--bun' || arg === '--root') {
      const value = args[++i];
      if (!value || value.startsWith('--')) throw new Error(`${arg} requires a path`);
      if (arg === '--bun') bunArg = value;
      else installRoot = resolve(value);
    } else if (arg === '--help') {
      console.log('node windows/from-source.mjs [--check] [--build-only] [--bun <bun.exe>] [--root <install-directory>]');
      process.exit(0);
    } else throw new Error(`Unknown option: ${arg}`);
  }
  if (process.platform !== 'win32' || process.arch !== 'x64') throw new Error('Native source installation requires Windows x64');
  const [major, minor] = process.versions.node.split('.').map(Number);
  if (major < 22 || major === 22 && minor < 13) throw new Error('Install Node.js >= 22.13, then open a new terminal');
  // A worktree or shared dependency junction must never mutate another checkout.
  for (const name of ['.git', 'node_modules']) {
    const path = join(root, name);
    if (!existsSync(path)) {
      if (name === '.git') throw new Error('Use a Git clone of the Windows branch, not a source ZIP');
      continue;
    }
    const entry = lstatSync(path);
    if (entry.isSymbolicLink() || !entry.isDirectory()) throw new Error(`Use an independent clone: ${name} must be a real directory`);
  }
  const sourcePath = Object.entries(process.env).find(([key]) => key.toLowerCase() === 'path')?.[1] || '';
  function executable(name) {
    const candidates = isAbsolute(name) || /[\\/]/.test(name)
      ? [resolve(name)]
      : sourcePath.split(';').filter(Boolean).map(dir => join(dir.replace(/^"|"$/g, ''), name));
    const found = candidates.find(path => { try { return statSync(path).isFile(); } catch { return false; } });
    if (!found) throw new Error(`Cannot find ${name}. Install Git for Windows and Bun ${release.bunVersion}, or pass --bun <bun.exe>`);
    return found;
  }
  const bun = executable(bunArg || process.env.BOTMUX_BUILD_BUN || 'bun.exe');
  const git = executable('git.exe');
  const env = { ...process.env, ELECTRON_SKIP_BINARY_DOWNLOAD: '1', BOTMUX_BUILD_BUN: bun };
  for (const key of Object.keys(env)) if (key.toLowerCase() === 'path') delete env[key];
  env.Path = [dirname(process.execPath), dirname(bun), dirname(git), sourcePath].join(';');
  function run(command, argv, capture = false) {
    const result = spawnSync(command, argv, {
      cwd: root, env, windowsHide: true,
      ...(capture ? { encoding: 'utf8', maxBuffer: 4 * 1024 * 1024 } : { stdio: 'inherit' }),
    });
    if (result.error || result.status !== 0) throw result.error || new Error(`${command} exited ${result.status}${capture ? `: ${result.stderr}` : ''}`);
    return capture ? result.stdout.trim() : undefined;
  }
  const bunVersion = run(bun, ['--version'], true);
  if (bunVersion !== release.bunVersion) throw new Error(`Bun ${release.bunVersion} required, found ${bunVersion}. Install the pinned version or pass --bun <bun.exe>`);
  const sourceCommit = run(git, ['rev-parse', 'HEAD'], true);
  if (run(git, ['status', '--porcelain', '--untracked-files=normal'], true)) {
    throw new Error('Commit source changes or use a clean independent clone before building');
  }
  console.log(JSON.stringify({ platform: process.platform, arch: process.arch, node: process.versions.node,
    bun: bunVersion, version: release.version, sourceCommit, sourceRoot: root }));
  if (checkOnly) process.exit(0);
  run(bun, ['install', '--frozen-lockfile']);
  // Reuse the upstream recipe; its executable-bit step uses a portable Node helper.
  run(process.execPath, [join(root, 'windows/build.mjs')]);
  const candidate = join(root, 'build/windows-native');
  if (buildOnly) console.log(`Candidate ready: ${candidate}`);
  else {
    run(process.execPath, [join(root, 'windows/manage.mjs'), 'install', candidate,
      ...(installRoot ? ['--root', installRoot] : [])]);
    console.log('Installed. Run the installed botmux.cmd setup, then botmux.cmd start when configuration is ready.');
  }
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
