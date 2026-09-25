import { describe, expect, it, vi } from 'vitest';
import { codexRpcEligible, hasReadyWindowsRpcInput, orchestrateCodexRpcInit, type RpcInitEffects } from '../../src/codex-rpc-lifecycle.js';
import type { DaemonToWorker } from '../../src/types.js';
type Init = Extract<DaemonToWorker, {type: 'init'}>;
const config = (over: Partial<Init> = {}): Init => ({type:'init',sessionId:'win-rpc',chatId:'chat',rootMessageId:'root',workingDir:'C:/work',cliId:'traex',backendType:'pty',codexRpcInput:true,prompt:'中文、输入',larkAppId:'test',larkAppSecret:'test',...over});
const runtime = {platform: 'win32' as const};
const effects = (outcome: 'accepted'|'ambiguous'|'not-engaged'|'resumed'): RpcInitEffects => ({paneInfo:vi.fn(()=>null),paneIsRemote:vi.fn(()=>false),prepare:vi.fn(async()=>{}),engage:vi.fn(async()=>outcome),killVerify:vi.fn(async()=>true),teardownEngine:vi.fn(),log:vi.fn(),notify:vi.fn()});
describe('Windows TraeX RPC input',()=>{
 it('enables only the verified Windows TraeX PTY combination',()=>{
  expect(codexRpcEligible(config(),runtime)).toBe(true);
  expect(codexRpcEligible(config(),{platform:'linux'})).toBe(false);
  expect(codexRpcEligible(config({cliId:'codex'}),runtime)).toBe(false);
  expect(codexRpcEligible(config({backendType:'tmux'}),{platform:'linux'})).toBe(true);
 });
 it.each([{sandbox:true},{readIsolation:true},{disableCliBypass:true},{startupCommands:['/effort high']},{wrapperCli:'wrapper'},{cliPathOverride:'C:/wrapper.cmd'},{codexRpcInput:false}])('keeps security and launch gates: %j',async over=>{
  const cfg=config(over as Partial<Init>), fx=effects('accepted');
  expect(codexRpcEligible(cfg,runtime)).toBe(false);
  await expect(orchestrateCodexRpcInit(cfg,fx,runtime)).rejects.toThrow('Windows TraeX');
  expect(fx.engage).not.toHaveBeenCalled();
 });
 it.each(['accepted','ambiguous'] as const)('never queues a dispatched %s first turn',async outcome=>{
  const fx=effects(outcome);
  expect(await orchestrateCodexRpcInit(config(),fx,runtime)).toEqual({engaged:true,queuePrompt:false,abortSpawn:false});
  expect(fx.paneInfo).not.toHaveBeenCalled();
 });
 it('aborts rather than falling back to TUI after engine setup failure',async()=>{
  await expect(orchestrateCodexRpcInit(config(),effects('not-engaged'),runtime)).rejects.toThrow('Windows TraeX');
 });
 it('resumes through a fresh engine and queues only the waking prompt',async()=>{
  expect(await orchestrateCodexRpcInit(config({resume:true,cliSessionId:'native-thread'}),effects('resumed'),runtime)).toEqual({engaged:true,queuePrompt:true,abortSpawn:false});
 });
});


describe('Windows RPC initialization evidence', () => {
  it('requires an engaged native thread, not just an enabled setting', () => {
    expect(hasReadyWindowsRpcInput(config(), undefined, 'win32')).toBe(false);
    expect(hasReadyWindowsRpcInput(undefined, 'thread', 'win32')).toBe(false);
    expect(hasReadyWindowsRpcInput(config(), 'thread', 'win32')).toBe(true);
    expect(hasReadyWindowsRpcInput(config({ resume: true, prompt: '', cliSessionId: 'thread' }), 'thread', 'win32')).toBe(true);
  });
  it('retains platform, CLI, backend and security boundaries', () => {
    expect(hasReadyWindowsRpcInput(config(), 'thread', 'linux')).toBe(false);
    for (const over of [{ cliId: 'codex' }, { backendType: 'tmux' }, { codexRpcInput: false }, { sandbox: true }, { disableCliBypass: true }]) {
      expect(hasReadyWindowsRpcInput(config(over as Partial<Init>), 'thread', 'win32')).toBe(false);
    }
  });
});
