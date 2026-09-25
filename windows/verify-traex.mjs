#!/usr/bin/env node
// Explicit, authenticated smoke. Uses the installed native TraeX, makes three
// harmless model calls, and retains its thread as reviewable evidence.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { CodexRpcEngine } from '../dist/codex-rpc-engine.js';
import { closeHostPty, disposeExitedHostPty, hostPtyOptions } from '../dist/host/runtime.js';
const require = createRequire(import.meta.url);
const pty = require('node-pty');
assert.equal(process.platform, 'win32');
const cliBin = process.argv[2];
assert.ok(cliBin?.endsWith('.exe'), 'Pass the absolute native traex.exe path');
const cwd = mkdtempSync(join(tmpdir(), 'botmux rpc 中文 '));
const sessionId = `win-smoke-${randomUUID()}`;
const terminals = [];
let engine, viewer;
const pids = [];
const alive = pid => { try { process.kill(pid, 0); return true; } catch { return false; } };
const wait = async (predicate, label, ms = 60_000) => {
  const until = Date.now() + ms;
  while (Date.now() < until) { if (await predicate()) return; await new Promise(r => setTimeout(r, 200)); }
  throw new Error(`Timed out: ${label}`);
};
const makeEngine = () => new CodexRpcEngine({cliBin, cwd, env: {...process.env}, sessionId,
  onTurnTerminal: t => terminals.push(t), log: m => console.log(m)});
const inputs = [
  'Reply exactly OK. Do not use tools. Inert Unicode sample: a、b、c 中文、引号" and newline\n第二行。',
  'Reply exactly TWO. Do not use tools. Second input 中文、测试、保持一致。',
  'Reply exactly THREE. Do not use tools. Resumed input 中文、恢复、无重复。',
];
const completed = async (turnId) => {
  await wait(() => terminals.some(t => t.identity.turnId === turnId), `terminal ${turnId}`);
  assert.equal(terminals.find(t => t.identity.turnId === turnId).status, 'completed');
};
try {
  engine = makeEngine(); await engine.start(); pids.push(engine.appServerPid);
  const tid = await engine.startThread();
  const first = await engine.sendFirstTurn(inputs[0], {turnId:'one'}, async()=>false);
  assert.equal(first.outcome, 'accepted'); assert.ok(first.nativeTurnId);
  await completed('one');
  viewer = pty.spawn(cliBin, ['--remote',engine.wsUrl,'resume','--no-alt-screen','-c','check_for_update_on_startup=false',tid],
    {cwd,env:{...process.env},cols:140,rows:40,...hostPtyOptions()});
  pids.push(viewer.pid);
  let screen = ''; viewer.onData(text => {screen=(screen+text).slice(-100_000)});
  const ownedViewer = viewer;
  viewer.onExit(() => disposeExitedHostPty(ownedViewer));
  await wait(() => /OK/.test(screen), 'remote viewer renders first result');
  await engine.sendTurn(inputs[1],{turnId:'two'}); await completed('two');
  await wait(() => /TWO/.test(screen), 'remote viewer renders follow-up result');
  closeHostPty(viewer); viewer = undefined;
  const oldPid = engine.appServerPid;
  // Start the replacement with the same session marker while the old engine
  // lives: exercises Windows PID+endpoint attestation and orphan-tree cleanup.
  const oldEngine = engine;
  engine = makeEngine(); await engine.start(); pids.push(engine.appServerPid);
  await wait(() => !alive(oldPid), 'old app-server reaped', 10_000);
  oldEngine.stop();
  assert.equal(await engine.resumeThread(tid), tid);
  await engine.sendTurn(inputs[2],{turnId:'three'}); await completed('three');
  let texts;
  await wait(async () => {
    const result = await engine.request('thread/read',{threadId:tid,includeTurns:true});
    texts=(result.thread?.turns??[]).flatMap(t=>t.items??[]).filter(i=>i.type==='userMessage')
      .flatMap(i=>i.content??[]).filter(c=>c.type==='text').map(c=>c.text);
    return texts.length >= 3;
  }, 'three persisted inputs');
  assert.deepEqual(texts, inputs, 'exact text, exactly three deliveries across restart');
  assert.equal(terminals.filter(t=>t.status==='completed').length, 3);
  console.log(JSON.stringify({ok:true,threadId:tid,turns:3,exactText:true,viewer:true,restart:true,orphanReaped:true}));
} finally {
  if (viewer) closeHostPty(viewer);
  engine?.stop();
  await wait(() => pids.every(pid => !alive(pid)), 'all owned processes stopped', 10_000);
  rmSync(cwd, {recursive:true,force:true});
}
