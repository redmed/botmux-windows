import { describe, expect, it } from 'vitest';
// @ts-expect-error JavaScript release helper is also its own CLI entry point
import { parseArgs, releaseCoordinates } from '../../windows/publish-release.mjs';

describe('Windows release publisher', () => {
  it('derives the protected branch and tag from a release version', () => {
    expect(releaseCoordinates('3.31.0-win.2')).toEqual({
      baseVersion: '3.31.0',
      branch: 'windows/native-v3.31.0',
      tag: 'windows-v3.31.0-win.2',
    });
    expect(() => releaseCoordinates('3.31.0')).toThrow('Invalid Windows release version');
  });

  it('is a dry run unless publishing is explicit', () => {
    expect(parseArgs([])).toEqual({ publish: false, remote: 'fork', help: false });
    expect(parseArgs(['--remote', 'origin', '--publish'])).toEqual({ publish: true, remote: 'origin', help: false });
    expect(() => parseArgs(['--remote', '../bad'])).toThrow('Invalid Git remote name');
  });
});
