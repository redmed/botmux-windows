import { readFileSync } from 'node:fs';
import ts from 'typescript';
import { describe, expect, it, vi } from 'vitest';
import { hasReadyWindowsRpcInput } from '../../src/codex-rpc-lifecycle.js';
import { inspectPostTerminalComposer } from '../../src/utils/pty-input-policy.js';

const worker = readFileSync(new URL('../../src/worker.ts', import.meta.url), 'utf8');
const slice = (start: string, end: string) => worker.slice(worker.indexOf(start), worker.indexOf(end));

function harness(platform: NodeJS.Platform, rpc: boolean, thread: string | undefined) {
  const reset = vi.fn();
  const globals = {
    windowsRpcInputReady: () => hasReadyWindowsRpcInput(
      { cliId: 'traex', backendType: 'pty', codexRpcInput: rpc } as never, thread, platform,
    ),
    backendScreenEvidenceIsAuthoritativeForMutation: () => true,
    captureBackendScreen: () => '', // RPC viewer need not draw a composer.
    inspectPostTerminalComposer,
    codexBridgeQueue: { peek: () => [{ started: true, finalText: 'first answer' }] },
    idleDetector: { reset },
    schedulePostTerminalFenceRecheck: vi.fn(),
    log: vi.fn(),
    cliName: () => 'TRAE',
  };
  const source = `
    const backend = {};
    const cliSpawnGeneration = 1;
    const cliAdapter = { postTerminalPromptFence: true, readyPattern: /composer/ };
    let isPromptReady = true;
    let postTerminalInputFence = null;
    ${slice('function currentPostTerminalInputFence()', 'let postTerminalFenceRecheckPending')}
    ${slice('function postTerminalPromptFenceHolds(', 'function deferPromptReadyWhileBusy(')}
    return {
      terminal: () => armPostTerminalInputFence(),
      idle: () => postTerminalPromptFenceHolds('external', backend),
      state: () => ({ ready: isPromptReady, fenced: postTerminalInputFence !== null }),
    };
  `;
  const { outputText } = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022 } });
  const api = new Function(...Object.keys(globals), outputText)(...Object.values(globals)) as {
    terminal(): void;
    idle(): boolean;
    state(): { ready: boolean; fenced: boolean };
  };
  return { ...api, reset };
}

describe('Windows RPC successor input with a blank viewer', () => {
  it('does not wait for a PTY composer after the acknowledged RPC turn completes', () => {
    const h = harness('win32', true, 'native-thread');
    h.terminal();
    expect(h.state()).toEqual({ ready: true, fenced: false });
    expect(h.idle()).toBe(false);
    expect(h.reset).not.toHaveBeenCalled();
  });

  it.each([
    ['linux', true, 'native-thread'],
    ['win32', false, 'native-thread'],
    ['win32', true, undefined],
  ] as const)('keeps the screen fence for platform=%s rpc=%s thread=%s', (platform, rpc, thread) => {
    const h = harness(platform, rpc, thread);
    h.terminal();
    expect(h.state()).toEqual({ ready: false, fenced: true });
    expect(h.idle()).toBe(true);
    expect(h.reset).toHaveBeenCalledOnce();
  });
});
