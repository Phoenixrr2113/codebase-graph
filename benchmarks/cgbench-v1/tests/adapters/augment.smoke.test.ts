import { describe, expect, it } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { AugmentAdapter } from '../../src/adapters/augment.js';

describe('AugmentAdapter (Plan 3 stub)', () => {
  it('throws BLOCKED on ingest', async () => {
    const adapter = new AugmentAdapter({ dataDir: mkdtempSync('/tmp/cgbench-augment-') });
    await expect(adapter.ingest({ codeRoots: [] })).rejects.toThrow(/BLOCKED/);
  });

  it('throws BLOCKED on query', async () => {
    const adapter = new AugmentAdapter({ dataDir: mkdtempSync('/tmp/cgbench-augment-') });
    await expect(adapter.query('q')).rejects.toThrow(/BLOCKED/);
  });
});
