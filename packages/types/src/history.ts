/**
 * Git history window and coverage contracts.
 * Frozen by the orchestrator for the history/ownership batch; consumed by
 * core git sync (window resolution and persistence) and graph analysis
 * queries (coverage reporting). Do not extend without updating both sides.
 */

export interface HistoryWindowOptions {
  /** Inclusive ISO 8601 lower bound for initial history backfill. */
  historySince?: string;
  /** Safety ceiling for initial history backfill. */
  historyMaxCommits?: number;
}

export interface HistoryCoverage {
  /** Distinct indexed commits observed after the analysis filters. */
  commitCount: number;
  /** Earliest observed commit date after the analysis filters. */
  earliestCommitDate: string | null;
  /** Latest observed commit date after the analysis filters. */
  latestCommitDate: string | null;
  /** Reachable commits reported by git at the last history sync. */
  totalCommitCount: number | null;
  /** Persisted effective lower bound for history indexing. */
  historySince: string | null;
  /** Persisted initial-backfill safety ceiling. */
  historyMaxCommits: number | null;
  /** Deprecated compatibility alias for historyMaxCommits. */
  historyWindowSize: number | null;
  /** True when the effective indexed window omitted reachable history. */
  historyTruncated: boolean;
  /** True when all reachable branch history was indexed at the last sync. */
  historyComplete: boolean;
}
