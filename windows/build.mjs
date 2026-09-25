#!/usr/bin/env node
/** Separate packaging recipe: leave upstream's manifest/lock/release pipeline intact. */
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const release = JSON.parse(readFileSync(join(root, 'windows/release.json'), 'utf8'));
const out = join(root, 'build', 'windows-native');
function run(command, args, cwd = root) {
  const result = spawnSync(command, args, { cwd, stdio: 'inherit' });
  if (result.error || result.status !== 0) throw result.error || new Error(`${command} failed: ${result.status}`);
}
const bun = process.env.BOTMUX_BUILD_BUN || 'bun';
const bunVersion = spawnSync(bun, ['--version'], { encoding: 'utf8' }).stdout?.trim();
if (bunVersion !== release.bunVersion) throw new Error(`Build requires Bun ${release.bunVersion}, got ${bunVersion}`);
if (!process.argv.includes('--skip-build')) run(bun, ['run', 'build']);
if (!existsSync(join(root, 'dist/.runtime-build-id'))) throw new Error('Build output missing');
rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
// Preserve the dependency graph while staging (same approach as upstream desktop).
delete pkg.scripts;
writeFileSync(join(out, 'package.json'), JSON.stringify(pkg, null, 2));
cpSync(join(root, 'bun.lock'), join(out, 'bun.lock'));
run(bun, ['install', '--production', '--frozen-lockfile', '--ignore-scripts', '--os', 'win32', '--cpu', 'x64'], out);
rmSync(join(out, 'node_modules/.bin'), { recursive: true, force: true });
const ptySource = join(root, 'node_modules/node-pty');
cpSync(ptySource, join(out, 'node_modules/node-pty'), {
  recursive: true, dereference: true,
  filter: path => !relative(ptySource, path).split(/[\\/]/).includes('build'),
});
for (const platform of readdirSync(join(out, 'node_modules/node-pty/prebuilds'))) {
  if (platform !== 'win32-x64') rmSync(join(out, 'node_modules/node-pty/prebuilds', platform), { recursive: true, force: true });
}
for (const file of ['conpty.node', 'conpty_console_list.node']) {
  if (!existsSync(join(out, 'node_modules/node-pty/prebuilds/win32-x64', file))) throw new Error(`Missing Windows PTY prebuild ${file}`);
}
cpSync(join(root, 'dist'), join(out, 'dist'), {
  recursive: true, filter: path => !/\.d\.ts(?:\.map)?$/.test(path),
});
cpSync(join(root, 'LICENSE'), join(out, 'LICENSE'));
mkdirSync(join(out, 'windows'));
for (const file of ['manage.mjs', 'verify.mjs', 'verify-traex.mjs']) cpSync(join(root, 'windows', file), join(out, 'windows', file));
pkg.version = release.version;
pkg.engines = { node: `>=${release.nodeMinimum}` };
delete pkg.devDependencies;
delete pkg.optionalDependencies;
delete pkg.trustedDependencies;
delete pkg.packageManager;
pkg.private = true;
writeFileSync(join(out, 'package.json'), JSON.stringify(pkg, null, 2) + '\n');
rmSync(join(out, 'bun.lock'));
// Published runtime needs JS/assets/native binaries, not TypeScript declarations
// or PDB symbol databases. Avoid pruning arbitrary directories: packages may
// load runtime data from names such as test/ or docs/.
function prune(dir) {
  for (const entry of readdirSync(dir)) {
    const file = join(dir, entry);
    if (statSync(file).isDirectory()) prune(file);
    else if (/\.d\.(?:ts|mts|cts)(?:\.map)?$|\.pdb$/i.test(entry)) rmSync(file);
  }
}
prune(out);
const hashes = {};
function walk(dir) {
  for (const entry of readdirSync(dir).sort()) {
    const file = join(dir, entry);
    if (statSync(file).isDirectory()) walk(file);
    else hashes[relative(out, file).replaceAll('\\', '/')] = createHash('sha256').update(readFileSync(file)).digest('hex');
  }
}
walk(out);
const sourceCommit = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).stdout.trim();
const sourcePatch = spawnSync('git', ['diff', '--binary', 'HEAD'], { cwd: root, encoding: 'utf8', maxBuffer: 20*1024*1024 }).stdout;
writeFileSync(join(out, 'windows-manifest.json'), JSON.stringify({
  ...release, platform: 'win32-x64', sourceCommit,
  sourcePatchSha256: createHash('sha256').update(sourcePatch).digest('hex'),
  runtimeBuildId: readFileSync(join(out, 'dist/.runtime-build-id'), 'utf8').trim(), hashes,
}, null, 2) + '\n');
console.log(`Windows artifact staged: ${out}`);
