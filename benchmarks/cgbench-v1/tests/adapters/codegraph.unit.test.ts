import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CodeGraphAdapter } from '../../src/adapters/codegraph.js';

describe('CodeGraphAdapter — FalkorDB-Docker-only constraint', () => {
  let dataDir: string;
  const originalDriver = process.env['CODEGRAPH_DRIVER'];

  beforeEach(() => {
    dataDir = mkdtempSync(join(tmpdir(), 'cg-unit-'));
  });

  afterEach(() => {
    rmSync(dataDir, { recursive: true, force: true });
    if (originalDriver === undefined) {
      delete process.env['CODEGRAPH_DRIVER'];
    } else {
      process.env['CODEGRAPH_DRIVER'] = originalDriver;
    }
  });

  it('throws when CODEGRAPH_DRIVER=falkordblite', async () => {
    process.env['CODEGRAPH_DRIVER'] = 'falkordblite';
    const adapter = new CodeGraphAdapter({ dataDir });
    await expect(
      adapter.attach({ codeRoots: [{ language: 'typescript', path: dataDir, commitSha: 'test' }] }),
    ).rejects.toThrow(/falkordblite is not supported/i);
  });
});
