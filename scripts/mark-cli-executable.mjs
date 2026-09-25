#!/usr/bin/env node
import { chmodSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const cli = fileURLToPath(new URL('../dist/cli.js', import.meta.url));
const mode = statSync(cli).mode;
// Windows launches this JS entry through Node; POSIX retains chmod +x semantics.
if (process.platform !== 'win32') chmodSync(cli, mode | 0o111);
