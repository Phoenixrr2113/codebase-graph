import { describe, expect, it } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { CogneeAdapter } from '../../src/adapters/cognee.js';

describe('CogneeAdapter (Plan 3 stub)', () => {
  it('throws BLOCKED on ingest', async () => {
    const adapter = new CogneeAdapter({
      dataDir: mkdtempSync('/tmp/cgbench-cognee-stub-'),
    });
    await expect(
      adapter.ingest({ codeRoots: [] }),
    ).rejects.toThrow(/BLOCKED/);
  });

  it('throws BLOCKED on query', async () => {
    const adapter = new CogneeAdapter({
      dataDir: mkdtempSync('/tmp/cgbench-cognee-stub-'),
    });
    await expect(adapter.query('q')).rejects.toThrow(/BLOCKED/);
  });
});
