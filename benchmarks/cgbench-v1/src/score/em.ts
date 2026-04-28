export function exactMatch(ranking: string[], gold: string): 0 | 1 {
  return ranking[0] === gold ? 1 : 0;
}
