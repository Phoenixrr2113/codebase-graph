export function reciprocalRank(ranking: string[], gold: Set<string>): number {
  for (let i = 0; i < ranking.length; i++) {
    if (gold.has(ranking[i]!)) return 1 / (i + 1);
  }
  return 0;
}

export function mrr(rankings: string[][], golds: Set<string>[]): number {
  if (rankings.length !== golds.length) {
    throw new Error(`mrr: rankings.length (${rankings.length}) !== golds.length (${golds.length})`);
  }
  if (rankings.length === 0) return 0;
  const sum = rankings.reduce((acc, r, i) => acc + reciprocalRank(r, golds[i]!), 0);
  return sum / rankings.length;
}
