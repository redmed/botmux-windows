---
name: botmux-windows-upgrade
description: Upgrade, validate, publish, or deploy the redmed/botmux-windows fork against a newer official BotMux release. Use when asked to check upstream BotMux updates, prepare a windows/native-vX.Y.Z branch, build or test the Windows runtime, publish an X.Y.Z-win.N GitHub Release, or upgrade the dev-win current-user installation.
---

# BotMux Windows upgrade

Use repository scripts for deterministic operations and use judgment for upstream diffs, compatibility, and release gates. Treat preparation, publication, and deployment as separate authority boundaries.

## Establish the release state

1. Work from the `redmed/botmux-windows` clone. Read `CLAUDE.md`, `README.fork.md`, `windows/README.md`, `windows/VALIDATION.md`, and `windows/release.json` before editing.
2. Inspect the worktree, current branch, remotes, local tags, remote branches, GitHub Releases, and the official upstream tags. Preserve unrelated user changes.
3. Resolve “latest” to a concrete official stable tag and commit. Report “already current” when no newer stable version exists.
4. Keep branch roles strict:
   - Keep Fork `master` aligned with official upstream `master`; do not merge Windows-only commits into it.
   - Use `windows/native-vX.Y.Z` for each supported upstream version.
   - Use GitHub Release `latest` as the public pointer to the newest validated Windows build. Do not create a second Windows master unless the user explicitly chooses a rolling branch and accepts its maintenance cost.

## Prepare a candidate

For a new official version, start from a clean committed Windows branch and run:

```sh
node windows/sync-upstream.mjs vX.Y.Z X.Y.Z-win.1 ../botmux-windows-X.Y.Z
```

Work only in the new checkout. The script replays the downstream commit stack and creates `windows/native-vX.Y.Z`; a clean rebase proves only Git compatibility.

Review every conflict and every upstream change touching Windows integration points, including process launch, CLI entrypoints, PTY, paths, runtime packaging, dependencies, setup, session recovery, and release workflows. Resolve according to current upstream behavior rather than mechanically choosing one side.

For another Windows revision on the same upstream version, increment `-win.N` on the existing version branch. Synchronize at least:

- `windows/release.json`
- the default `Version` in `windows/install.ps1`
- version-specific installation examples and validation notes

Keep `package.json` version under upstream control. Keep the Windows runtime as a GitHub Release asset rather than committing the binary archive to Git history.

## Validate the candidate

Use an independent clone with independent dependencies for a source build. Never run dependency installation in a worktree whose `node_modules` is shared by symlink or junction.

Require all applicable gates:

1. Run the Windows-focused regression set from `.github/workflows/windows-release.yml` and record exact counts.
2. Complete the Windows native source build with the pinned Bun version from `windows/release.json`.
3. Build the Windows runtime on Linux or CI, then verify the exact artifact on Windows with Node 22 and 24.
4. Verify manifest and archive SHA-256, CLI version, argument handling, process tree, ConPTY, install, upgrade, and rollback behavior.
5. When installer logic changes, exercise normal download/extraction and every changed fallback such as missing `curl.exe` or `tar.exe`.
6. Use an isolated profile and test robot for live message tests. Verify first input, consecutive input, no duplicate reply, non-ASCII text, daemon restart, and native session resume when those paths changed.
7. Update `windows/VALIDATION.md` with evidence and remaining limitations.

Do not treat a successful build, clean rebase, CLI version output, or process status alone as end-to-end proof.

## Publish only with explicit authority

Commit all candidate changes and push the version branch. Run the release assistant in read-only mode first:

```sh
node windows/publish-release.mjs
```

Only when the user explicitly requests publication, run:

```sh
node windows/publish-release.mjs --remote fork --publish
```

Monitor `.github/workflows/windows-release.yml` through completion. Confirm Linux build, Windows Node 22/24 jobs, GitHub Release publication, and HTTP 200 for `install.ps1`, the ZIP, and its SHA-256. Install from the public URL into an isolated Windows root and verify the reported version.

Treat pushed release tags as immutable. If a tagged run fails, fix the cause, increment `-win.N`, commit, and publish a new tag.

## Deploy only with explicit authority

Deploy to the dev-win current-user installation only when requested. Before stopping BotMux, verify that no turn is running. Preserve `%USERPROFILE%\.botmux` and the prior installed release.

Use these current-user locations unless the repository documents a newer decision:

- Program: `%LOCALAPPDATA%\BotmuxWindows`
- Configuration: `%USERPROFILE%\.botmux`
- Command directory: `%LOCALAPPDATA%\BotmuxWindows\bin`

Stop the fleet, run the published installer, start the fleet, check supervisor/Bot/Dashboard status, and obtain a real test-bot reply. Do not delete sessions, credentials, or configuration unless the user explicitly requests that separate action.

## Completion report

Report the official upstream tag and commit, Windows version and tag, branch and commit, CI run result, artifact URLs, local and Windows test results, deployed version if applicable, rollback version, and any unverified boundary. Distinguish source preparation, GitHub publication, and live deployment so one cannot be mistaken for another.
