/**
 * Recall@K and Precision@K — set-based.
 *
 * Recall@K    = |unique top-K ∩ gold| / |gold|
 * Precision@K = |unique top-K ∩ gold| / K
 *
 * Both metrics dedup the top-K ranking before counting hits. Without dedup, a
 * ranking that repeats the same gold ID N times would score recall = N/|gold|,
 * which can exceed 1.0 — incorrect against the standard set-based definitions.
 * Adapters that legitimately surface the same source document via multiple
 * extracted facts (e.g. CodeGraph's knowledge entities all carrying
 * `cgbench:fact-005`) would otherwise inflate scores unfairly.
 */
export function recallAtK(ranking: string[], gold: Set<string>, k: number): number {
  if (gold.size === 0) return 0;
  const seen = new Set<string>();
  let hits = 0;
  for (let i = 0; i < ranking.length && seen.size < k; i++) {
    const r = ranking[i]!;
    if (seen.has(r)) continue;
    seen.add(r);
    if (gold.has(r)) hits++;
  }
  return hits / gold.size;
}

export function precisionAtK(ranking: string[], gold: Set<string>, k: number): number {
  if (k <= 0) return 0;
  const seen = new Set<string>();
  let hits = 0;
  for (let i = 0; i < ranking.length && seen.size < k; i++) {
    const r = ranking[i]!;
    if (seen.has(r)) continue;
    seen.add(r);
    if (gold.has(r)) hits++;
  }
  return hits / k;
}
