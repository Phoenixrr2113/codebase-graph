import { describe, expect, it } from 'vitest';
import { supportsEmbeddedPlatform } from '../client';

describe('supportsEmbeddedPlatform', () => {
  it('accepts platforms with published FalkorDBLite binaries', () => {
    expect(supportsEmbeddedPlatform('darwin', 'arm64')).toBe(true);
    expect(supportsEmbeddedPlatform('linux', 'x64')).toBe(true);
  });

  it('rejects platforms without published FalkorDBLite binaries', () => {
    expect(supportsEmbeddedPlatform('win32', 'x64')).toBe(false);
    expect(supportsEmbeddedPlatform('darwin', 'x64')).toBe(false);
    expect(supportsEmbeddedPlatform('linux', 'arm64')).toBe(false);
  });
});
