import { describe, expect, it } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { MastraAdapter } from '../../src/adapters/mastra.js';

describe('MastraAdapter (Plan 3 stub)', () => {
  it('throws DEFERRED on ingest', async () => {
    const adapter = new MastraAdapter({
      dataDir: mkdtempSync('/tmp/cgbench-mastra-stub-'),
    });
    await expect(
      adapter.ingest({ codeRoots: [] }),
    ).rejects.toThrow(/DEFERRED/);
  });

  it('throws DEFERRED on query', async () => {
    const adapter = new MastraAdapter({
      dataDir: mkdtempSync('/tmp/cgbench-mastra-stub-'),
    });
    await expect(adapter.query('q')).rejects.toThrow(/DEFERRED/);
  });
});
