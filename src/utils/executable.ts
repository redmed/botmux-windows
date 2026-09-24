import { accessSync, constants, statSync } from 'node:fs';

export function isExecutable(path: string): boolean {
  try {
    // A directory can carry the `x` bit (it means "traversable"), so an X_OK
    // check alone would accept a directory that merely shares an executable's
    // name on PATH. Require a regular file (statSync follows symlinks, so a
    // symlink → real binary still qualifies) before trusting the mode bit.
    if (!statSync(path).isFile()) return false;
    accessSync(path, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

export { resolveHostExecutable as locateExecutable } from '../host/runtime.js';
