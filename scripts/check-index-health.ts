/**
 * Index health checks for the search benchmark.
 * See docs/superpowers/specs/2026-04-30-search-benchmark-regression-detection-design.md
 */

export type CheckStatus = 'pass' | 'warn' | 'fail';

export interface CheckResult {
  name: string;
  status: CheckStatus;
  message: string;
  /** Present when status is 'fail' — contains the concrete shell command to resolve the issue. */
  fix?: string;
}

export interface HealthCheckOpts {
  /** Path to a specific baseline JSON for Check 6. null skips Check 6. */
  compareAgainst?: string | null;
  /** When false, skip checks that require an existing index (used pre-reindex). */
  requireIndex?: boolean;
}

export interface HealthCheckResult {
  checks: CheckResult[];
  hasFailures: boolean;
  hasWarnings: boolean;
}

export async function checkIndexHealth(_opts: HealthCheckOpts): Promise<HealthCheckResult> {
  return {
    checks: [],
    hasFailures: false,
    hasWarnings: false,
  };
}
