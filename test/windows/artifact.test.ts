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
it('keeps the release bootstrap pinned to the declared Windows version', () => {
  const release = JSON.parse(readFileSync(join(process.cwd(), 'windows/release.json'), 'utf8'));
  const installer = readFileSync(join(process.cwd(), 'windows/install.ps1'), 'utf8');
  const gitBashInstaller = readFileSync(join(process.cwd(), 'windows/install-git-bash.sh'), 'utf8');
  const releaseNotes = readFileSync(join(process.cwd(), 'windows/release-notes.md'), 'utf8');
  const releaseWorkflow = readFileSync(join(process.cwd(), '.github/workflows/windows-release.yml'), 'utf8');
  const releaseNotesWorkflow = readFileSync(join(process.cwd(), '.github/workflows/windows-release-notes.yml'), 'utf8');
  expect(installer).toContain(`[string]$Version = '${release.version}'`);
  expect(installer).toContain(`[Version]'${release.nodeMinimum}'`);
  expect(installer).toContain('releases/download/$tag');
  expect(installer).toContain('Get-FileHash -Algorithm SHA256');
  expect(installer).toContain('Get-Command curl.exe -ErrorAction SilentlyContinue');
  expect(installer).toContain('Invoke-WebRequest -UseBasicParsing');
  expect(installer).toContain('Get-Command Expand-Archive -ErrorAction SilentlyContinue');
  expect(installer).toContain("Write-Host 'BotMux 安装未完成' -ForegroundColor Red");
  expect(installer).toContain('请先确认没有正在执行的任务，然后运行 botmux stop');
  expect(installer).toContain('Remove-NodeWarningLines');
  expect(gitBashInstaller).toContain('powershell.exe -NoProfile -ExecutionPolicy Bypass -File');
  expect(gitBashInstaller).toContain('cygpath -w');
  expect(gitBashInstaller).toContain('chcp.com 65001');
  expect(gitBashInstaller).toContain('BOTMUX_INSTALLER_URL');
  expect(releaseWorkflow).toContain('- uses: actions/checkout@v4');
  expect(releaseWorkflow).toContain('cp windows/install-git-bash.sh release/install-git-bash.sh');
  expect(releaseWorkflow).toContain('body_path: windows/release-notes.md');
  expect(releaseNotes).toContain('releases/latest/download/install.ps1');
  expect(releaseNotes).toContain('releases/latest/download/install-git-bash.sh');
  expect(releaseNotes).toContain('botmux autostart enable');
  expect(releaseNotes).toContain('README.fork.md#%E6%8E%A8%E8%8D%90%E5%AE%89%E8%A3%85%E5%B7%B2%E7%BC%96%E8%AF%91%E7%89%88%E6%9C%AC');
  expect(releaseNotesWorkflow).toContain('gh release edit "${tag}" --notes-file windows/release-notes.md');
});
