export function recallAtK(ranking: string[], gold: Set<string>, k: number): number {
  if (gold.size === 0) return 0;
  const top = ranking.slice(0, k);
  let hits = 0;
  for (const r of top) if (gold.has(r)) hits++;
  return hits / gold.size;
}

export function precisionAtK(ranking: string[], gold: Set<string>, k: number): number {
  if (k <= 0) return 0;
  const top = ranking.slice(0, k);
  let hits = 0;
  for (const r of top) if (gold.has(r)) hits++;
  return hits / k;
}
