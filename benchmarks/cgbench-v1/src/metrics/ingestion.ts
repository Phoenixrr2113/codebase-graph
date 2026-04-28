export interface IngestionInput {
  tokensIn: number;
  durationMs: number;
}

export function computeThroughput({ tokensIn, durationMs }: IngestionInput): number {
  if (durationMs <= 0) return 0;
  return (tokensIn / durationMs) * 1000;
}

export interface IngestionReport {
  durationMs: number;
  totalDocs: number;
  totalTokens: number;
  diskBytesAfter: number;
  tokensPerSecond: number;
}

export function ingestionReport(args: {
  durationMs: number;
  totalDocs: number;
  totalTokens: number;
  diskBytesAfter: number;
}): IngestionReport {
  return {
    ...args,
    tokensPerSecond: computeThroughput({ tokensIn: args.totalTokens, durationMs: args.durationMs }),
  };
}
