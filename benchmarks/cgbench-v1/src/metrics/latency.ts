export interface LatencySample {
  ms: number;
  cold: boolean;
}

export interface LatencyBucket {
  count: number;
  p50: number;
  p95: number;
  p99: number;
  mean: number;
  min: number;
  max: number;
}

export interface LatencyReport {
  cold: LatencyBucket;
  warm: LatencyBucket;
  all: LatencyBucket;
}

export function percentile(samples: number[], p: number): number {
  if (samples.length === 0) throw new Error('percentile: empty samples');
  const sorted = [...samples].sort((a, b) => a - b);
  const idx = Math.max(0, Math.ceil((p / 100) * sorted.length) - 1);
  return sorted[idx]!;
}

function bucket(samples: number[]): LatencyBucket {
  if (samples.length === 0) {
    return { count: 0, p50: 0, p95: 0, p99: 0, mean: 0, min: 0, max: 0 };
  }
  const sum = samples.reduce((a, b) => a + b, 0);
  return {
    count: samples.length,
    p50: percentile(samples, 50),
    p95: percentile(samples, 95),
    p99: percentile(samples, 99),
    mean: sum / samples.length,
    min: Math.min(...samples),
    max: Math.max(...samples),
  };
}

export function aggregate(samples: LatencySample[]): LatencyReport {
  const cold = samples.filter((s) => s.cold).map((s) => s.ms);
  const warm = samples.filter((s) => !s.cold).map((s) => s.ms);
  const all = samples.map((s) => s.ms);
  return { cold: bucket(cold), warm: bucket(warm), all: bucket(all) };
}
