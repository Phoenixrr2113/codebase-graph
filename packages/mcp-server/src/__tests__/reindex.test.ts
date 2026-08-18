import { describe, expect, it, beforeAll, afterAll, beforeEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { triggerReindex } from '../tools/reindex';
import { closeGraphClient } from '@codegraph/core';

// Tiny in-memory corpus so reindex completes in seconds.
function makeFixture(): string {
  const dir = mkdtempSync(join(tmpdir(), 'reindex-test-'));
  mkdirSync(join(dir, 'src'), { recursive: true });
  writeFileSync(
    join(dir, 'src', 'hello.ts'),
    `export function hello(name: string): string { return \`hello \${name}\`; }`,
  );
  return dir;
}

describe('triggerReindex blocks on embeddings by default', () => {
  let fixture: string;
  beforeAll(() => {
    process.env['CODEGRAPH_EMBEDDING_PROVIDER'] = 'local';
    fixture = makeFixture();
  });
  beforeEach(async () => {
    await closeGraphClient();
  });
  afterAll(async () => {
    await closeGraphClient();
    process.env['CODEGRAPH_EMBEDDING_PROVIDER'] = 'none';
    rmSync(fixture, { recursive: true, force: true });
  });

  it('returns embeddingsDeferred=false and embeddedCount>0 after reindex', async () => {
    const result = await triggerReindex({ scope: fixture, mode: 'full' });
    expect(result.success).toBe(true);
    expect(result.symbolsUpdated).toBeGreaterThan(0);
    expect(result.embeddingsDeferred).toBe(false);
    expect(result.embeddedCount ?? 0).toBeGreaterThan(0);
  }, 120_000);

  it('respects deferEmbeddings=true override (returns embeddingsDeferred=true)', async () => {
    const fixture2 = makeFixture();
    try {
      const result = await triggerReindex({ scope: fixture2, mode: 'full', deferEmbeddings: true });
      expect(result.success).toBe(true);
      expect(result.embeddingsDeferred).toBe(true);
      expect(result.symbolsUpdated).toBeGreaterThan(0);
      expect(result.embeddedCount).toBeDefined();
    } finally {
      rmSync(fixture2, { recursive: true, force: true });
    }
  }, 120_000);
});
