import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileP = promisify(execFile);

export interface RssSample {
  t: number;
  rssBytes: number;
}

export interface RssSampler {
  stop(): Promise<RssSample[]>;
}

export function startRssSampler(pid: number, intervalMs: number): RssSampler {
  const samples: RssSample[] = [];
  const start = Date.now();
  let stopped = false;
  let inFlight = false;

  const handle = setInterval(() => {
    if (stopped || inFlight) return;
    inFlight = true;
    execFileP('ps', ['-o', 'rss=', '-p', String(pid)])
      .then(({ stdout }) => {
        const kb = parseInt(stdout.trim(), 10);
        if (!Number.isNaN(kb)) {
          samples.push({ t: Date.now() - start, rssBytes: kb * 1024 });
        }
      })
      .catch(() => {
        stopped = true;
      })
      .finally(() => {
        inFlight = false;
      });
  }, intervalMs);

  return {
    async stop(): Promise<RssSample[]> {
      stopped = true;
      clearInterval(handle);
      await new Promise((r) => setTimeout(r, intervalMs + 5));
      return samples;
    },
  };
}

export async function measureDiskBytes(path: string): Promise<number> {
  const { stdout } = await execFileP('du', ['-sk', path]);
  const kb = parseInt(stdout.trim().split(/\s+/)[0]!, 10);
  return kb * 1024;
}

export function summarizeRss(samples: RssSample[]): { peakBytes: number; steadyBytes: number } {
  if (samples.length === 0) return { peakBytes: 0, steadyBytes: 0 };
  const peak = Math.max(...samples.map((s) => s.rssBytes));
  const tail = samples.slice(Math.floor(samples.length / 2)).map((s) => s.rssBytes).sort((a, b) => a - b);
  const steady = tail[Math.floor(tail.length / 2)] ?? 0;
  return { peakBytes: peak, steadyBytes: steady };
}
