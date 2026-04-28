import { describe, expect, it } from 'vitest';
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { measureDiskBytes, startRssSampler, summarizeRss } from '../../src/metrics/resources.js';

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
  // Real-process sampling under vitest's parallel workers is timing-sensitive
  // (ps latency varies with system load). We assert that the sampler captured
  // at least one sample with a positive RSS value, and exercise determinism
  // of the math separately via summarizeRss tests below.
  it('captures samples from current process', async () => {
    const sampler = startRssSampler(process.pid, 50);
    await new Promise((r) => setTimeout(r, 250));
    const samples = await sampler.stop();
    expect(samples.length).toBeGreaterThanOrEqual(1);
    expect(samples[0]!.rssBytes).toBeGreaterThan(0);
  });
});

describe('summarizeRss', () => {
  it('returns zeros for empty input', () => {
    expect(summarizeRss([])).toEqual({ peakBytes: 0, steadyBytes: 0 });
  });

  it('peak is the max rssBytes across samples', () => {
    const r = summarizeRss([
      { t: 0, rssBytes: 100 },
      { t: 50, rssBytes: 300 },
      { t: 100, rssBytes: 200 },
    ]);
    expect(r.peakBytes).toBe(300);
  });

  it('steady-state is median of last half of samples', () => {
    // 6 samples; last half (slice(3)) = [400, 300, 500]; sorted = [300,400,500]; median = 400.
    const r = summarizeRss([
      { t: 0, rssBytes: 100 },
      { t: 25, rssBytes: 150 },
      { t: 50, rssBytes: 200 },
      { t: 75, rssBytes: 400 },
      { t: 100, rssBytes: 300 },
      { t: 125, rssBytes: 500 },
    ]);
    expect(r.steadyBytes).toBe(400);
  });
});
