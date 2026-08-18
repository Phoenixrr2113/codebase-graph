import { describe, expect, it } from 'vitest';
import { supportsEmbeddedPlatform } from '../client';

describe('supportsEmbeddedPlatform', () => {
  it('accepts platforms with binaries and required runtime libraries', () => {
    expect(supportsEmbeddedPlatform('darwin', 'arm64', () => true)).toBe(true);
    expect(supportsEmbeddedPlatform('linux', 'x64')).toBe(true);
  });

  it('rejects Apple silicon when a Homebrew runtime library is missing', () => {
    const availableLibraries = new Set(['/opt/homebrew/opt/libomp/lib/libomp.dylib']);

    expect(supportsEmbeddedPlatform(
      'darwin',
      'arm64',
      (path) => availableLibraries.has(path),
    )).toBe(false);
  });

  it('rejects platforms without published FalkorDBLite binaries', () => {
    expect(supportsEmbeddedPlatform('win32', 'x64')).toBe(false);
    expect(supportsEmbeddedPlatform('darwin', 'x64')).toBe(false);
    expect(supportsEmbeddedPlatform('linux', 'arm64')).toBe(false);
  });
});
