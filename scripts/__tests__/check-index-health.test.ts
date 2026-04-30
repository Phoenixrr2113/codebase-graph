import { describe, it, expect } from 'vitest';
import { checkIndexHealth, type HealthCheckResult } from '../check-index-health.js';
import { checkFalkorDBReachable } from '../check-index-health.js';

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

describe('Check 1: FalkorDB reachable', () => {
  it('passes against a live FalkorDB Docker', async () => {
    const result = await checkFalkorDBReachable({
      host: process.env['FALKORDB_HOST'] ?? 'localhost',
      port: Number(process.env['FALKORDB_PORT'] ?? '6379'),
    });
    expect(result.status).toBe('pass');
    expect(result.name).toBe('falkordb-reachable');
  });

  it('fails with fix message when host is unreachable', async () => {
    const result = await checkFalkorDBReachable({
      host: 'localhost',
      port: 64999,  // intentionally closed port
    });
    expect(result.status).toBe('fail');
    expect(result.message).toMatch(/not reachable/i);
    expect(result.fix).toMatch(/docker run/);
    expect(result.fix).toMatch(/64999/);
  });
});
