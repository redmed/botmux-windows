#!/usr/bin/env node
/** Replay the small downstream commit stack in a NEW checkout. Never pull
 * upstream directly into an installed runtime or alter a running installation. */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const [ref, version, destination] = process.argv.slice(2);
if (!ref || !/^\d+\.\d+\.\d+-win\.\d+$/.test(version || '') || !destination) {
  throw new Error('Usage: node windows/sync-upstream.mjs <upstream-ref> <X.Y.Z-win.N> <new-checkout>');
}
const out = resolve(destination);
if (existsSync(out)) throw new Error('Destination must not exist');
function git(args, cwd = root) {
  const result = spawnSync('git', args, { cwd, encoding: 'utf8', maxBuffer: 8 * 1024 * 1024 });
  if (result.status !== 0) throw new Error(result.stderr || result.stdout || `git ${args[0]} failed`);
  return result.stdout.trim();
}
if (git(['status', '--porcelain', '--untracked-files=normal'])) throw new Error('Commit downstream changes before synchronization');
const old = JSON.parse(readFileSync(join(root, 'windows/release.json'), 'utf8'));
git(['fetch', 'upstream', ref]);
const target = git(['rev-parse', 'FETCH_HEAD']);
const touched = git(['diff', '--name-only', old.upstreamCommit, 'HEAD', '--', 'src']);
const overlap = touched ? git(['diff', '--name-only', old.upstreamCommit, target, '--', ...touched.split('\n')]) : '';
console.log(`Upstream ${ref}: ${target}\nIntegration files changed upstream:\n${overlap || '(none)'}`);
git(['clone', '--no-hardlinks', '--no-checkout', root, out]);
git(['remote', 'add', 'upstream', old.upstreamRepository], out);
// FETCH_HEAD in the source is not a branch and a local clone need not copy
// its unreachable objects. Fetch the pinned target in the new checkout too.
git(['fetch', 'upstream', target], out);
git(['checkout', '-b', `windows/${version}`, git(['rev-parse', 'HEAD'])], out);
try {
  git(['rebase', '--onto', target, old.upstreamCommit], out);
} catch (error) {
  throw new Error(`Rebase needs review in ${out}. Installed version is unchanged.\n${error.message}`);
}
const manifestPath = join(out, 'windows/release.json');
writeFileSync(manifestPath, JSON.stringify({ ...old, upstreamRef: ref, upstreamCommit: target, version }, null, 2) + '\n');
console.log(`Prepared ${out}. Review and commit release.json, then run frozen install, build, Windows tests and packaging. A clean rebase alone is not a compatibility proof.`);
