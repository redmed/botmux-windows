#!/usr/bin/env node
/** Authenticated Windows worker smoke: fresh turns + a new worker resuming the
 * same native thread. No daemon or Lark credentials, no external messages. */
import assert from 'node:assert/strict';
import { fork, spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { homedir, tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
assert.equal(process.platform, 'win32');
const cli = process.argv[2];
assert.ok(cli && /\.exe$/i.test(cli), 'Pass the native traex.exe path');
const runtime = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const root = mkdtempSync(join(tmpdir(), 'botmux-worker-rpc-'));
const traeHome = process.env.TRAE_HOME || join(homedir(), '.trae');
const sessionId = randomUUID();
const env = {...process.env, HOME:root, USERPROFILE:root, SESSION_DATA_DIR:join(root,'data'),
  BOTMUX_SESSION_ID:sessionId, TRAE_HOME:traeHome, PATH:dirname(cli)+';'+process.env.PATH};
mkdirSync(env.SESSION_DATA_DIR, {recursive:true});
const runs = [];
const wait = async (predicate, label, timeout = 30_000) => {
  const until = Date.now() + timeout;
  while (Date.now() < until) { if (predicate()) return; await new Promise(r=>setTimeout(r,100)); }
  throw new Error(`Timed out: ${label}; evidence in ${root}`);
};
function start(resumeId) {
  const run = {messages:[], log:'', pids:new Set(), started:Date.now()};
  run.child = fork(join(runtime,'dist/worker.js'),[],{cwd:root,env,stdio:['ignore','pipe','pipe','ipc']});
  run.child.stdout.on('data',s=>run.log+=s); run.child.stderr.on('data',s=>run.log+=s);
  run.child.on('message',m=>{
    run.messages.push(m);
    if (m.type==='ready') run.readyAt=Date.now();
    if (m.type==='local_process_attestation') {
      if(m.enginePid)run.pids.add(m.enginePid);if(m.cliPid)run.pids.add(m.cliPid);
    }
  });
  runs.push(run);
  const turnId = resumeId ? 'worker-resumed' : 'worker-first';
  run.child.send({type:'init',sessionId,chatId:'oc_test',rootMessageId:'om_test',workingDir:root,
    cliId:'traex',backendType:'pty',codexRpcInput:true,
    ...(resumeId?{resume:true,cliSessionId:resumeId}:{}),
    prompt:`Reply exactly ${resumeId?'WORKER-RESUMED':'WORKER-FIRST'} 中文、正常. Do not use tools.`,
    turnId,queuedActivationToken:turnId,larkAppId:'app_worker_smoke',larkAppSecret:'test'});
  return run;
}
async function close(run) {
  if(run.child.connected)run.child.send({type:'close'});
  await wait(()=>run.child.exitCode!==null||run.child.signalCode!==null,'worker close',10_000);
  await wait(()=>[...run.pids].every(pid=>{try{process.kill(pid,0);return false}catch{return true}}),'owned process cleanup',10_000);
}
try {
  const first = start();
  await wait(()=>first.messages.some(m=>m.type==='final_output'&&m.turnId==='worker-first'),'first final');
  first.child.send({type:'message',content:'Reply exactly WORKER-SECOND 中文、正常. Do not use tools.',turnId:'worker-second'});
  await wait(()=>first.messages.some(m=>m.type==='final_output'&&m.turnId==='worker-second'),'second final');
  assert.equal(first.messages.filter(m=>m.type==='queued_activation_submitted').length,1);
  const nativeId=first.messages.find(m=>m.type==='cli_session_id')?.cliSessionId;
  assert.ok(nativeId);await close(first);
  const resumed=start(nativeId);
  // win.2 waits for an absent viewer prompt, then a 90-second fallback. This
  // bounded check fails that version and proves the resumed input is redriven.
  await wait(()=>resumed.messages.some(m=>m.type==='queued_activation_submitted'),'resumed input acknowledgement');
  const acknowledgedAfterMs=Date.now()-resumed.started;
  await wait(()=>resumed.messages.some(m=>m.type==='final_output'&&m.turnId==='worker-resumed'),'resumed final');
  assert.equal(resumed.messages.find(m=>m.type==='cli_session_id')?.cliSessionId,nativeId);
  assert.equal(resumed.messages.filter(m=>m.type==='queued_activation_submitted').length,1);
  assert.equal(runs.flatMap(r=>r.messages).filter(m=>m.type==='final_output').length,3);
  assert.equal(runs.flatMap(r=>r.messages).filter(m=>m.type==='user_notify').length,0);
  await close(resumed);
  console.log(JSON.stringify({ok:true,sessionId,cliSessionId:nativeId,turns:3,acknowledgedAfterMs,evidenceDir:root}));
} finally {
  for (const [i,run] of runs.entries()) {
    writeFileSync(join(root,`worker-${i}.log`),run.log);
    writeFileSync(join(root,`worker-${i}-events.json`),JSON.stringify(run.messages.map(m=>({type:m.type,turnId:m.turnId,status:m.status})),null,2));
    if (run.child.connected) run.child.send({type:'close'});
    await new Promise(r=>setTimeout(r,500));
    if (run.child.exitCode===null && run.child.signalCode===null) {
      spawnSync('taskkill.exe',['/PID',String(run.child.pid),'/T','/F'],{stdio:'ignore',windowsHide:true});
    }
  }
}
