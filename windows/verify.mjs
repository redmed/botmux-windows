#!/usr/bin/env node
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(join(root, 'package.json'));
assert.equal(process.platform, 'win32', 'Run candidate verification on Windows');
assert.equal(process.arch, 'x64');
const [major, minor] = process.versions.node.split('.').map(Number);
assert.ok(major > 22 || major === 22 && minor >= 13, 'Node >= 22.13 required for SQLite');
const pkg = require('./package.json');
const version = spawnSync(process.execPath, [join(root, 'dist/cli.js'), '--version'], { encoding: 'utf8', timeout: 30_000, windowsHide: true });
assert.equal(version.status, 0, version.stderr);
assert.ok(version.stdout.includes(pkg.version), `Version mismatch: ${version.stdout}`);
const pty = require('node-pty');
const { PtyBackend } = await import('../dist/adapters/backend/pty-backend.js');
async function probe(command, args, marker) {
  const backend = new PtyBackend();
  let output = '';
  await new Promise((done, fail) => {
    const timer = setTimeout(() => { backend.kill(); fail(new Error(`PTY timeout: ${output}`)); }, 20_000);
    try {
      backend.spawn(command, args, { cwd: root, env: process.env, cols: 100, rows: 30 });
      backend.onData(text => { output += text; });
      backend.onExit(code => {
        clearTimeout(timer);
        backend.kill(); backend.kill(); // closing an exited/previously closed console is idempotent
        code === 0 && output.includes(marker) ? done() : fail(new Error(`PTY code=${code}: ${output}`));
      });
    } catch (error) { clearTimeout(timer); fail(error); }
  });
}
await probe(process.execPath, ['-e', 'console.log("windows-pty-ok 中文");'], 'windows-pty-ok 中文');
const scratch = mkdtempSync(join(tmpdir(), 'botmux windows smoke '));
try {
  const recorder = join(scratch, 'record.cjs');
  const batch = join(scratch, 'cli wrapper.cmd');
  const expectedArgs = ['space value', 'a&b', '中文'];
  const marker = Buffer.from(JSON.stringify(expectedArgs)).toString('base64');
  writeFileSync(recorder, 'console.log(Buffer.from(JSON.stringify(process.argv.slice(2))).toString("base64"));');
  const nativeArgs = ['中文', 'quotes " and backslash \\', '100% ! &', 'two\nlines'];
  await probe(process.execPath, [recorder, ...nativeArgs], Buffer.from(JSON.stringify(nativeArgs)).toString('base64'));
  writeFileSync(batch, `@echo off\r\n"${process.execPath}" "${recorder}" %*\r\n`);
  await probe(batch, expectedArgs, marker);
  const childPidFile = join(scratch, 'child.pid');
  const backend = new PtyBackend();
  await new Promise((done, fail) => {
    const timer = setTimeout(() => { backend.kill(); fail(new Error('Tree spawn timeout')); }, 15_000);
    backend.spawn(process.execPath, ['-e', `const cp=require('node:child_process'),fs=require('node:fs');const c=cp.spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{stdio:'ignore'});fs.writeFileSync(process.argv[1],String(c.pid));console.log('tree-ready');setInterval(()=>{},1000);`, childPidFile], { cwd: scratch, env: process.env, cols: 100, rows: 30 });
    backend.onData(text => { if (text.includes('tree-ready')) { clearTimeout(timer); done(); } });
  });
  const childPid = Number(readFileSync(childPidFile, 'utf8'));
  backend.kill(); backend.kill();
  let alive = true;
  for (let attempt = 0; attempt < 30; attempt++) {
    try { process.kill(childPid, 0); } catch { alive = false; break; }
    await new Promise(done => setTimeout(done, 100));
  }
  assert.equal(alive, false, 'PTY kill left a grandchild running');
} finally { rmSync(scratch, { recursive: true, force: true }); }
if (process.env.BOTMUX_TEST_TRAEX) await probe(process.env.BOTMUX_TEST_TRAEX, ['--version'], 'internal edition');
console.log(JSON.stringify({ ok: true, version: pkg.version, node: process.versions.node, pty: typeof pty.spawn === 'function', traex: Boolean(process.env.BOTMUX_TEST_TRAEX) }));
