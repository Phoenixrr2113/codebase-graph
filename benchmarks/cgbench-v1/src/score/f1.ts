export function f1(retrieved: Set<string>, gold: Set<string>): number {
  if (retrieved.size === 0 || gold.size === 0) return 0;
  let tp = 0;
  for (const r of retrieved) if (gold.has(r)) tp++;
  if (tp === 0) return 0;
  const precision = tp / retrieved.size;
  const recall = tp / gold.size;
  return (2 * precision * recall) / (precision + recall);
}

export function weightedF1(f1a: number, f1b: number, wa: number, wb: number): number {
  if (Math.abs(wa + wb - 1) > 1e-9) {
    throw new Error(`weightedF1: weights must sum to 1, got ${wa + wb}`);
  }
  return wa * f1a + wb * f1b;
}
