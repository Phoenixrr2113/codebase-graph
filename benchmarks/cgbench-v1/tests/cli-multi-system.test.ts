import { describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { makeAdapter } from '../src/cli.js';

const SYSTEMS = [
  'codegraph',
  'mcp-codebase-index',
  'mempalace',
  'cognee',
  'hindsight',
  'mastra-memory',
  'supermemory',
  'augment',
];

describe('CLI makeAdapter — supports all 8 systems', () => {
  for (const sys of SYSTEMS) {
    it(`constructs ${sys} adapter`, () => {
      const dataDir = mkdtempSync(`/tmp/cgbench-multi-${sys}-`);
      try {
        const adapter = makeAdapter(sys, dataDir);
        expect(adapter.name).toBe(sys);
      } finally {
        rmSync(dataDir, { recursive: true, force: true });
      }
    });
  }

  it('throws for unknown system', () => {
    expect(() => makeAdapter('unknown-xyz', '/tmp')).toThrow(/unknown system/);
  });
});
