import { describe, it, expect } from 'vitest';
import { checkIndexHealth, type HealthCheckResult } from '../check-index-health.js';

describe('checkIndexHealth', () => {
  it('returns a HealthCheckResult shape', async () => {
    const result: HealthCheckResult = await checkIndexHealth({ requireIndex: false });
    expect(result).toHaveProperty('checks');
    expect(result).toHaveProperty('hasFailures');
    expect(result).toHaveProperty('hasWarnings');
    expect(Array.isArray(result.checks)).toBe(true);
    expect(result.hasFailures).toBe(false);
    expect(result.hasWarnings).toBe(false);
  });
});
