#!/usr/bin/env node
/** Verify -> immutable release directory -> one atomic active pointer.
 * Program files live outside .botmux. No configuration migration is performed. */
import { createHash } from 'node:crypto';
import { cpSync, existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, realpathSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

export async function verifyArtifact(dir) {
  const manifest = JSON.parse(readFileSync(join(dir, 'windows-manifest.json'), 'utf8'));
  if (manifest.platform !== 'win32-x64' || !/^\d+\.\d+\.\d+-win\.\d+$/.test(manifest.version)) throw new Error('Invalid Windows release manifest');
  if (!manifest.hashes || !Object.hasOwn(manifest.hashes, 'dist/cli.js') || !Object.hasOwn(manifest.hashes, 'windows/verify.mjs')) throw new Error('Incomplete manifest');
  const visited = new Set();
  const files = [];
  function visit(base) {
    for (const entry of readdirSync(base, { withFileTypes: true })) {
      const file = join(base, entry.name);
      const key = relative(dir, file).replaceAll('\\', '/');
      if (entry.isSymbolicLink()) throw new Error(`Symlinks are not allowed in releases: ${key}`);
      if (entry.isDirectory()) visit(file);
      else if (key !== 'windows-manifest.json') { files.push({ file, key }); visited.add(key); }
    }
  }
  visit(dir);
  for (const file of Object.keys(manifest.hashes)) {
    if (isAbsolute(file) || file.split(/[\\/]/).includes('..') || !visited.has(file)) throw new Error(`Missing or unsafe manifest path: ${file}`);
  }
  // Parallel reads matter on Windows VMs with high per-open filesystem latency.
  // Bound concurrency to avoid holding the whole runtime in memory at once.
  let cursor = 0;
  await Promise.all(Array.from({ length: 16 }, async () => {
    while (cursor < files.length) {
      const { file, key } = files[cursor++];
      const actual = createHash('sha256').update(await readFile(file)).digest('hex');
      if (!manifest.hashes[key] || manifest.hashes[key] !== actual) throw new Error(`Artifact integrity failed: ${key}`);
    }
  }));
  return manifest;
}

function readState(root) {
  const file = join(root, 'active.json');
  return existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : {};
}
function assertStopped(configDir) {
  const botsPath = join(configDir, 'bots.json');
  if (existsSync(botsPath) && !Array.isArray(JSON.parse(readFileSync(botsPath, 'utf8')))) throw new Error('bots.json must contain an array; no configuration was changed');
  const statePath = join(configDir, 'fleet-state.json');
  if (existsSync(statePath)) {
    const state = JSON.parse(readFileSync(statePath, 'utf8'));
    const pids = [state.supervisorPid, ...(state.procs || []).map(proc => proc.pid)];
    for (const pid of pids) {
      if (!Number.isSafeInteger(pid) || pid < 2) continue;
      try { process.kill(pid, 0); } catch (error) { if (error.code === 'ESRCH') continue; throw error; }
      throw new Error('Stop the running BotMux fleet before activation or rollback');
    }
  }
  // A legacy PM2 migration must be explicit. Never let a new release consume
  // the same bot events while the old PM2 fleet may still be alive.
  for (const base of [join(configDir, 'pm2/pids'), join(homedir(), '.pm2/pids')]) {
    if (!existsSync(base)) continue;
    for (const name of readdirSync(base).filter(name => /^botmux(?:-|\.)/.test(name))) {
      const pid = Number(readFileSync(join(base, name), 'utf8').trim());
      if (!Number.isSafeInteger(pid) || pid < 2) continue;
      try { process.kill(pid, 0); } catch (error) { if (error.code === 'ESRCH') continue; throw error; }
      throw new Error('A legacy BotMux PM2 process is alive; stop it before activation');
    }
  }
}
async function probe(dir, node) {
  await new Promise((done, fail) => {
    const child = spawn(node, [join(dir, 'windows/verify.mjs')], { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '', stderr = '', timedOut = false;
    child.stdout.on('data', data => { stdout = (stdout + data).slice(-64 * 1024); });
    child.stderr.on('data', data => { stderr = (stderr + data).slice(-64 * 1024); });
    const timer = setTimeout(() => {
      timedOut = true;
      // Kill the owned verifier tree while its root is still alive; killing
      // only the verifier would orphan the console/CLI processes it spawned.
      if (process.platform === 'win32' && child.pid) spawnSync('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore', timeout: 5_000 });
      child.kill();
    }, 90_000);
    child.on('error', error => { clearTimeout(timer); fail(error); });
    child.on('close', code => {
      clearTimeout(timer);
      if (timedOut || code !== 0 || /AttachConsole failed/.test(stderr)) fail(new Error(`Candidate verification ${timedOut ? 'timed out' : `failed (${code})`}: ${stderr || stdout}`));
      else { process.stdout.write(stdout); done(); }
    });
  });
}
export async function activate(root, candidate, configDir, node = process.execPath, verifier = probe) {
  root = resolve(root); candidate = resolve(candidate);
  mkdirSync(root, { recursive: true });
  const lock = join(root, '.activation-lock');
  mkdirSync(lock); // concurrent activations must never interleave
  try {
    assertStopped(configDir);
    const manifest = await verifyArtifact(candidate);
    const releaseDir = join(root, 'releases', manifest.version);
    const current = readState(root);
    if (!existsSync(releaseDir)) {
      const staging = join(root, `candidate-${process.pid}`);
      if (existsSync(staging)) throw new Error('Staging directory already exists');
      if (process.platform === 'win32') {
        const copied = spawnSync(join(process.env.SystemRoot || 'C:\\Windows', 'System32/robocopy.exe'),
          [candidate, staging, '/E', '/COPY:DAT', '/R:1', '/W:1', '/MT:16', '/NFL', '/NDL', '/NJH', '/NJS', '/NP'],
          { encoding: 'utf8', windowsHide: true });
        if (copied.error || copied.status === null || copied.status >= 8) throw copied.error || new Error(`Artifact copy failed (${copied.status})`);
      } else cpSync(candidate, staging, { recursive: true, errorOnExist: true, force: false });
      try {
        await verifyArtifact(staging);
        await verifier(staging, node);
        mkdirSync(dirname(releaseDir), { recursive: true });
        renameSync(staging, releaseDir);
      } finally { rmSync(staging, { recursive: true, force: true }); }
    } else {
      const existing = await verifyArtifact(releaseDir);
      if (JSON.stringify(existing.hashes) !== JSON.stringify(manifest.hashes)) throw new Error('Version already exists with different contents; increment the Windows patch version');
      await verifier(releaseDir, node);
    }
    assertStopped(configDir);
    const nodePath = realpathSync(node);
    const binDir = join(root, 'bin');
    mkdirSync(binDir, { recursive: true });
    const launcher = join(binDir, 'launch.cjs');
    // Static launcher: subsequent upgrades change active.json only.
    if (!existsSync(launcher)) writeFileSync(launcher, `const fs=require('node:fs'),p=require('node:path'),cp=require('node:child_process');\nconst root=p.resolve(__dirname,'..'),s=JSON.parse(fs.readFileSync(p.join(root,'active.json'),'utf8'));\nconst child=cp.spawn(s.node,[p.join(root,'releases',s.current,'dist','cli.js'),...process.argv.slice(2)],{stdio:'inherit',windowsHide:true});\nchild.on('error',e=>{console.error(e.message);process.exitCode=1});child.on('exit',(code)=>{process.exitCode=code??1});\n`);
    if (/["%\r\n!]/.test(nodePath + launcher)) throw new Error('Install location cannot contain batch expansion characters');
    if (!existsSync(join(binDir, 'botmux.cmd'))) writeFileSync(join(binDir, 'botmux.cmd'), `@echo off\r\n"${nodePath}" "${launcher}" %*\r\n`);
    const next = { current: manifest.version, previous: current.current !== manifest.version ? current.current ?? null : current.previous ?? null, node: nodePath };
    const tmp = join(root, `active.${process.pid}.tmp`);
    writeFileSync(tmp, JSON.stringify(next, null, 2) + '\n');
    renameSync(tmp, join(root, 'active.json'));
    return next;
  } finally { rmSync(lock, { recursive: true, force: true }); }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    if (process.platform !== 'win32') throw new Error('The installer must run on Windows');
    const args = process.argv.slice(2);
    const arg = key => args.includes(key) ? args[args.indexOf(key) + 1] : undefined;
    const root = resolve(arg('--root') || join(process.env.LOCALAPPDATA || homedir(), 'BotmuxWindows'));
    const configDir = join(homedir(), '.botmux');
    if (args[0] === 'status') console.log(JSON.stringify(readState(root), null, 2));
    else if (args[0] === 'install' || args[0] === 'rollback') {
      const candidate = args[0] === 'install' ? args[1] : (() => {
        const state = readState(root);
        if (!state.previous) throw new Error('No previous release to roll back to');
        return join(root, 'releases', state.previous);
      })();
      if (!candidate || candidate.startsWith('--')) throw new Error('Usage: node windows/manage.mjs install <unpacked-artifact> [--root <program-directory>]');
      console.log(JSON.stringify(await activate(root, candidate, configDir), null, 2));
    } else throw new Error('Usage: manage.mjs install <unpacked-artifact> | rollback | status [--root <directory>]');
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
