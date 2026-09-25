#!/usr/bin/env node
/**
 * Safely trigger the Windows build/verify/release workflow.
 *
 * The script intentionally does not build a release asset on the developer
 * machine. It proves that the committed release metadata and Git refs agree,
 * then an explicit --publish pushes the branch and an annotated tag. GitHub
 * Actions builds once on Linux, verifies that exact artifact on Windows with
 * Node 22 and 24, and only then creates the GitHub Release.
 */
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

export function releaseCoordinates(version) {
  const match = /^(\d+\.\d+\.\d+)-win\.(\d+)$/.exec(version);
  if (!match) throw new Error(`Invalid Windows release version: ${version}`);
  return {
    baseVersion: match[1],
    branch: `windows/native-v${match[1]}`,
    tag: `windows-v${version}`,
  };
}

export function parseArgs(argv) {
  const options = { publish: false, remote: 'fork', help: false };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--publish') options.publish = true;
    else if (arg === '--help' || arg === '-h') options.help = true;
    else if (arg === '--remote') {
      options.remote = argv[index + 1];
      index += 1;
      if (!options.remote || options.remote.startsWith('-')) throw new Error('--remote requires a Git remote name');
    } else throw new Error(`Unknown argument: ${arg}`);
  }
  if (!/^[A-Za-z0-9._-]+$/.test(options.remote)) throw new Error(`Invalid Git remote name: ${options.remote}`);
  return options;
}

function git(args, { allowFailure = false } = {}) {
  const result = spawnSync('git', args, { cwd: root, encoding: 'utf8', maxBuffer: 8 * 1024 * 1024 });
  if (!allowFailure && result.status !== 0) {
    throw new Error((result.stderr || result.stdout || `git ${args[0]} failed`).trim());
  }
  return result;
}

function output(args) {
  return git(args).stdout.trim();
}

function assertAncestor(ancestor, descendant, message) {
  const result = git(['merge-base', '--is-ancestor', ancestor, descendant], { allowFailure: true });
  if (result.status !== 0) throw new Error(message);
}

function printUsage() {
  console.log(`Usage: node windows/publish-release.mjs [--remote fork] [--publish]

Without --publish, run read-only preflight checks and print the planned tag.
With --publish, push the current Windows branch and annotated release tag.
The tag triggers .github/workflows/windows-release.yml; release assets are
built on Linux, verified on Windows Node 22/24, then published by CI.`);
}

export function main(argv = process.argv.slice(2)) {
  const options = parseArgs(argv);
  if (options.help) {
    printUsage();
    return;
  }

  const release = JSON.parse(readFileSync(join(root, 'windows/release.json'), 'utf8'));
  const { branch, tag } = releaseCoordinates(release.version);
  const currentBranch = output(['branch', '--show-current']);
  if (currentBranch !== branch) throw new Error(`Release ${release.version} must be published from ${branch}; current branch is ${currentBranch || '(detached HEAD)'}`);

  const dirty = output(['status', '--porcelain', '--untracked-files=normal']);
  if (dirty) throw new Error('Commit or remove all working-tree changes before publishing');

  output(['remote', 'get-url', options.remote]);
  output(['remote', 'get-url', 'upstream']);

  const installer = readFileSync(join(root, 'windows/install.ps1'), 'utf8');
  if (!installer.includes(`[string]$Version = '${release.version}'`)) {
    throw new Error(`windows/install.ps1 default version does not match ${release.version}`);
  }
  if (!installer.includes(`[Version]'${release.nodeMinimum}'`)) {
    throw new Error(`windows/install.ps1 Node minimum does not match ${release.nodeMinimum}`);
  }

  git(['fetch', '--quiet', 'upstream', release.upstreamRef]);
  const fetchedUpstream = output(['rev-parse', 'FETCH_HEAD^{commit}']);
  if (fetchedUpstream !== release.upstreamCommit) {
    throw new Error(`windows/release.json pins ${release.upstreamCommit}, but upstream ${release.upstreamRef} resolves to ${fetchedUpstream}`);
  }
  assertAncestor(release.upstreamCommit, 'HEAD', `HEAD does not contain the pinned upstream commit ${release.upstreamCommit}`);

  const remoteBranchRef = `refs/remotes/${options.remote}/${branch}`;
  const fetchBranch = git(['fetch', '--quiet', options.remote, `refs/heads/${branch}:${remoteBranchRef}`], { allowFailure: true });
  if (fetchBranch.status === 0) {
    assertAncestor(remoteBranchRef, 'HEAD', `Remote ${options.remote}/${branch} contains commits not present in HEAD; synchronize before publishing`);
  } else if (!`${fetchBranch.stderr}\n${fetchBranch.stdout}`.includes("couldn't find remote ref")) {
    throw new Error((fetchBranch.stderr || fetchBranch.stdout).trim());
  }

  const head = output(['rev-parse', 'HEAD']);
  const localTag = git(['rev-parse', '--verify', '--quiet', `refs/tags/${tag}^{commit}`], { allowFailure: true });
  if (localTag.status === 0 && localTag.stdout.trim() !== head) {
    throw new Error(`Local tag ${tag} already points to a different commit`);
  }
  if (localTag.status === 0 && output(['cat-file', '-t', `refs/tags/${tag}`]) !== 'tag') {
    throw new Error(`Local tag ${tag} must be annotated`);
  }

  const remoteTag = output(['ls-remote', '--tags', options.remote, `refs/tags/${tag}`, `refs/tags/${tag}^{}`]);
  if (remoteTag) throw new Error(`Remote tag ${tag} already exists; choose a new Windows release version`);

  console.log(`Preflight OK\n  version: ${release.version}\n  branch:  ${branch}\n  commit:  ${head}\n  tag:     ${tag}\n  remote:  ${options.remote}`);
  if (!options.publish) {
    console.log('\nDry run only. Re-run with --publish to push the branch and release tag.');
    return;
  }

  git(['push', options.remote, `HEAD:refs/heads/${branch}`]);
  if (localTag.status !== 0) git(['tag', '-a', tag, '-m', `BotMux Windows ${release.version} 自动构建发布`]);
  git(['push', options.remote, `refs/tags/${tag}`]);
  const repository = output(['remote', 'get-url', options.remote])
    .replace(/^git@github\.com:/, 'https://github.com/')
    .replace(/\.git$/, '');
  console.log(`\nRelease workflow triggered: ${repository}/actions/workflows/windows-release.yml`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    main();
  } catch (error) {
    console.error(`Windows release refused: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  }
}
