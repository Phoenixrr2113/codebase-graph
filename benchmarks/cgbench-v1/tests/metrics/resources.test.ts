import { describe, expect, it } from 'vitest';
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { measureDiskBytes, startRssSampler } from '../../src/metrics/resources.js';

describe('measureDiskBytes', () => {
  it('returns >= byte size of files in directory', async () => {
    const dir = join(tmpdir(), `cgbench-disk-${Date.now()}`);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'a.txt'), 'x'.repeat(1024));
    const bytes = await measureDiskBytes(dir);
    expect(bytes).toBeGreaterThanOrEqual(1024);
    rmSync(dir, { recursive: true });
  });
});

describe('startRssSampler', () => {
  it('captures samples from current process', async () => {
    const sampler = startRssSampler(process.pid, 50);
    await new Promise((r) => setTimeout(r, 200));
    const samples = await sampler.stop();
    expect(samples.length).toBeGreaterThanOrEqual(2);
    expect(samples[0]!.rssBytes).toBeGreaterThan(0);
  });
});
