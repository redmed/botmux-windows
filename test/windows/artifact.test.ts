import { createHash } from 'node:crypto';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it } from 'vitest';
// @ts-expect-error JS installer is also its own CLI entry point
import { activate, verifyArtifact } from '../../windows/manage.mjs';
const dirs: string[] = [];
function scratch() { const path = mkdtempSync(join(tmpdir(), 'win-artifact-')); dirs.push(path); return path; }
afterEach(() => dirs.splice(0).forEach(path => rmSync(path, { recursive: true, force: true })));
function candidate(version: string) {
  const path = scratch();
  mkdirSync(join(path, 'dist')); mkdirSync(join(path, 'windows'));
  const contents = { 'dist/cli.js': version, 'windows/verify.mjs': 'probe' };
  const hashes: Record<string, string> = {};
  for (const [file, text] of Object.entries(contents)) { writeFileSync(join(path, file), text); hashes[file] = createHash('sha256').update(text).digest('hex'); }
  writeFileSync(join(path, 'windows-manifest.json'), JSON.stringify({ version, platform: 'win32-x64', hashes }));
  return path;
}
it('activates, upgrades and rolls back without modifying configuration', async () => {
  const root = scratch(), config = scratch();
  writeFileSync(join(config, 'bots.json'), '[{"name":"unchanged"}]');
  const first = candidate('3.29.0-win.1'), second = candidate('3.29.0-win.2');
  const probe = () => {};
  expect((await activate(root, first, config, process.execPath, probe)).current).toBe('3.29.0-win.1');
  const launcher = readFileSync(join(root, 'bin/botmux.cmd'), 'utf8');
  expect((await activate(root, second, config, process.execPath, probe)).previous).toBe('3.29.0-win.1');
  expect((await activate(root, join(root, 'releases/3.29.0-win.1'), config, process.execPath, probe)).current).toBe('3.29.0-win.1');
  expect(readFileSync(join(root, 'bin/botmux.cmd'), 'utf8')).toBe(launcher);
  expect(readFileSync(join(config, 'bots.json'), 'utf8')).toBe('[{"name":"unchanged"}]');
});
it('keeps the active pointer and launcher unchanged when candidate verification fails', async () => {
  const root = scratch(), config = scratch();
  await activate(root, candidate('3.29.0-win.1'), config, process.execPath, () => {});
  const before = readFileSync(join(root, 'active.json'), 'utf8');
  await expect(activate(root, candidate('3.29.0-win.2'), config, process.execPath, async () => { await Promise.resolve(); throw new Error('probe failed'); })).rejects.toThrow('probe failed');
  expect(readFileSync(join(root, 'active.json'), 'utf8')).toBe(before);
  expect(existsSync(join(root, '.activation-lock'))).toBe(false);
});
it('rejects corrupt artifacts, extra files and malformed config before activation', async () => {
  const root = scratch(), config = scratch(), artifact = candidate('3.29.0-win.1');
  writeFileSync(join(artifact, 'dist/cli.js'), 'corrupt');
  await expect(verifyArtifact(artifact)).rejects.toThrow('integrity');
  const valid = candidate('3.29.0-win.1');
  writeFileSync(join(valid, 'untracked.exe'), 'extra');
  await expect(verifyArtifact(valid)).rejects.toThrow('integrity');
  writeFileSync(join(config, 'bots.json'), '{"value":[]}');
  await expect(activate(root, candidate('3.29.0-win.1'), config, process.execPath, () => {})).rejects.toThrow('array');
  expect(existsSync(join(root, 'active.json'))).toBe(false);
});
it('refuses activation while a fleet process is alive', async () => {
  const root = scratch(), config = scratch();
  writeFileSync(join(config, 'fleet-state.json'), JSON.stringify({ supervisorPid: process.pid }));
  await expect(activate(root, candidate('3.29.0-win.1'), config, process.execPath, () => {})).rejects.toThrow('Stop the running');
});
