import { describe, expect, it } from 'vitest';
import {
  isShaCheckedOut,
  parseManifest,
} from '../scripts/clone-corpora.js';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

describe('parseManifest', () => {
  it('reads + validates manifest.json', () => {
    const result = parseManifest();
    expect(result.corpora).toHaveLength(4);
  });
});

describe('isShaCheckedOut', () => {
  it('returns false for a non-git directory', () => {
    const dir = join(tmpdir(), `cgbench-test-${Date.now()}`);
    mkdirSync(dir, { recursive: true });
    expect(isShaCheckedOut(dir, 'abc123')).toBe(false);
  });
});
