/**
 * Impact Analysis Tests
 * Tests for analyzing code change impact and risk assessment
 */

import { describe, it, expect } from 'vitest';
import {
  analyzeImpact,
  classifyRisk,
  calculateRiskScore,
  getDirectCallersQuery,
  getTransitiveCallersQuery,
  getAffectedTestsQuery,
  isTestFile,
  getAffectedFiles,
  groupCallersByFile,
  getImpactSummary,
  RISK_WEIGHTS,
  RISK_THRESHOLDS,
  ImpactAnalysisInput,
} from '../analysis/impact';

describe('Impact Analysis', () => {
  describe('analyzeImpact', () => {
    it('should analyze impact with direct callers only', () => {
      const input: ImpactAnalysisInput = {
        target: { name: 'processPayment', file: 'src/payment.ts' },
        callers: [
          { name: 'checkout', file: 'src/checkout.ts', depth: 1 },
          { name: 'refund', file: 'src/refund.ts', depth: 1 },
        ],
        tests: [],
      };

      const result = analyzeImpact(input);

      expect(result.target.name).toBe('processPayment');
      expect(result.directCallers).toHaveLength(2);
      expect(result.transitiveCallers).toHaveLength(0);
      expect(result.hasTestCoverage).toBe(false);
    });

    it('should separate direct and transitive callers', () => {
      const input: ImpactAnalysisInput = {
        target: { name: 'validateUser', file: 'src/auth.ts' },
        callers: [
          { name: 'login', file: 'src/login.ts', depth: 1 },
          { name: 'handleRequest', file: 'src/api.ts', depth: 2 },
          { name: 'checkAdmin', file: 'src/admin.ts', depth: 3 },
        ],
        tests: [],
      };

      const result = analyzeImpact(input);

      expect(result.directCallers).toHaveLength(1);
      expect(result.directCallers[0].name).toBe('login');
      expect(result.transitiveCallers).toHaveLength(2);
    });

    it('should detect test coverage', () => {
      const input: ImpactAnalysisInput = {
        target: { name: 'formatDate', file: 'src/utils.ts' },
        callers: [],
        tests: [
          { name: 'test formatDate', file: 'src/utils.test.ts' },
        ],
      };

      const result = analyzeImpact(input);

      expect(result.hasTestCoverage).toBe(true);
      expect(result.affectedTests).toHaveLength(1);
      expect(result.riskBreakdown.testCoverageContribution).toBe(0);
    });

    it('should penalize lack of test coverage', () => {
      const input: ImpactAnalysisInput = {
        target: { name: 'criticalFunction', file: 'src/core.ts' },
        callers: [],
        tests: [],
      };

      const result = analyzeImpact(input);

      expect(result.hasTestCoverage).toBe(false);
      expect(result.riskBreakdown.testCoverageContribution).toBe(RISK_WEIGHTS.noTestCoveragePenalty);
    });

    it('should apply complexity penalty for high complexity', () => {
      const input: ImpactAnalysisInput = {
        target: { name: 'complexFunction', file: 'src/complex.ts', complexity: 25 },
        callers: [],
        tests: [],
      };

      const result = analyzeImpact(input);

      expect(result.riskBreakdown.complexityContribution).toBe(RISK_WEIGHTS.highComplexityPenalty);
    });

    it('should not apply complexity penalty for low complexity', () => {
      const input: ImpactAnalysisInput = {
        target: { name: 'simpleFunction', file: 'src/simple.ts', complexity: 5 },
        callers: [],
        tests: [{ name: 'test', file: 'test.ts' }],
      };

      const result = analyzeImpact(input);

      expect(result.riskBreakdown.complexityContribution).toBe(0);
    });

    it('should respect maxDepth option', () => {
      const input: ImpactAnalysisInput = {
        target: { name: 'deepFunction', file: 'src/deep.ts' },
        callers: [
          { name: 'level1', file: 'src/l1.ts', depth: 1 },
          { name: 'level2', file: 'src/l2.ts', depth: 2 },
          { name: 'level3', file: 'src/l3.ts', depth: 3 },
          { name: 'level4', file: 'src/l4.ts', depth: 4 },
        ],
        tests: [],
      };

      const result = analyzeImpact(input, { maxDepth: 2 });

      expect(result.directCallers).toHaveLength(1);
      expect(result.transitiveCallers).toHaveLength(1); // Only depth 2
    });

    it('should exclude transitive callers when includeTransitive is false', () => {
      const input: ImpactAnalysisInput = {
        target: { name: 'func', file: 'src/func.ts' },
        callers: [
          { name: 'direct', file: 'src/d.ts', depth: 1 },
          { name: 'indirect', file: 'src/i.ts', depth: 2 },
        ],
        tests: [],
      };

      const result = analyzeImpact(input, { includeTransitive: false });

      expect(result.directCallers).toHaveLength(1);
      expect(result.transitiveCallers).toHaveLength(0);
    });
  });

  describe('calculateRiskScore', () => {
    it('should calculate risk with all factors', () => {
      const score = calculateRiskScore(5, 10, false, 25);

      // 5 * 2 + 10 * 0.5 + 10 + 5 = 10 + 5 + 10 + 5 = 30
      expect(score).toBe(30);
    });

    it('should calculate risk with test coverage', () => {
      const score = calculateRiskScore(2, 4, true, 10);

      // 2 * 2 + 4 * 0.5 + 0 + 0 = 4 + 2 = 6
      expect(score).toBe(6);
    });

    it('should return zero for no callers with coverage', () => {
      const score = calculateRiskScore(0, 0, true, 5);

      expect(score).toBe(0);
    });
  });

  describe('classifyRisk', () => {
    it('should classify low risk', () => {
      expect(classifyRisk(0)).toBe('low');
      expect(classifyRisk(5)).toBe('low');
    });

    it('should classify medium risk', () => {
      expect(classifyRisk(6)).toBe('medium');
      expect(classifyRisk(15)).toBe('medium');
    });

    it('should classify high risk', () => {
      expect(classifyRisk(16)).toBe('high');
      expect(classifyRisk(30)).toBe('high');
    });

    it('should classify critical risk', () => {
      expect(classifyRisk(31)).toBe('critical');
      expect(classifyRisk(100)).toBe('critical');
    });
  });

  describe('Cypher Query Generators', () => {
    it('should generate direct callers query', () => {
      const query = getDirectCallersQuery('myFunction');

      expect(query).toContain('MATCH');
      expect(query).toContain(':Function');
      expect(query).toContain('myFunction');
      expect(query).toContain(':CALLS');
      expect(query).toContain('1 as depth');
    });

    it('should generate transitive callers query with default depth', () => {
      const query = getTransitiveCallersQuery('myFunction');

      expect(query).toContain(':CALLS*1..5');
      expect(query).toContain('myFunction');
      expect(query).toContain('length(path) as depth');
    });

    it('should generate transitive callers query with custom depth', () => {
      const query = getTransitiveCallersQuery('myFunction', 3);

      expect(query).toContain(':CALLS*1..3');
    });

    it('should generate affected tests query', () => {
      const query = getAffectedTestsQuery('myFunction');

      expect(query).toContain('myFunction');
      expect(query).toContain('.test.');
      expect(query).toContain('.spec.');
    });
  });

  describe('isTestFile', () => {
    it('should identify .test.ts files', () => {
      expect(isTestFile('utils.test.ts')).toBe(true);
      expect(isTestFile('src/utils.test.ts')).toBe(true);
    });

    it('should identify .spec.ts files', () => {
      expect(isTestFile('utils.spec.ts')).toBe(true);
    });

    it('should identify __tests__ directory', () => {
      expect(isTestFile('src/__tests__/utils.ts')).toBe(true);
    });

    it('should identify /test/ directory', () => {
      expect(isTestFile('src/test/utils.ts')).toBe(true);
    });

    it('should not flag regular source files', () => {
      expect(isTestFile('src/utils.ts')).toBe(false);
      expect(isTestFile('src/testing.ts')).toBe(false);
    });
  });

  describe('getAffectedFiles', () => {
    it('should return unique files', () => {
      const callers = [
        { name: 'a', file: 'file1.ts', depth: 1 },
        { name: 'b', file: 'file2.ts', depth: 1 },
        { name: 'c', file: 'file1.ts', depth: 2 },
      ];

      const files = getAffectedFiles(callers);

      expect(files).toHaveLength(2);
      expect(files).toContain('file1.ts');
      expect(files).toContain('file2.ts');
    });

    it('should handle empty list', () => {
      expect(getAffectedFiles([])).toHaveLength(0);
    });
  });

  describe('groupCallersByFile', () => {
    it('should group callers by file', () => {
      const callers = [
        { name: 'a', file: 'file1.ts', depth: 1 },
        { name: 'b', file: 'file2.ts', depth: 1 },
        { name: 'c', file: 'file1.ts', depth: 2 },
      ];

      const grouped = groupCallersByFile(callers);

      expect(grouped.get('file1.ts')).toHaveLength(2);
      expect(grouped.get('file2.ts')).toHaveLength(1);
    });
  });

  describe('getImpactSummary', () => {
    it('should return formatted summary', () => {
      const input: ImpactAnalysisInput = {
        target: { name: 'testFunc', file: 'test.ts' },
        callers: [
          { name: 'caller1', file: 'a.ts', depth: 1 },
        ],
        tests: [],
      };

      const result = analyzeImpact(input);
      const summary = getImpactSummary(result);

      expect(summary).toContain('testFunc');
      expect(summary).toContain('Direct callers: 1');
      expect(summary).toContain('Test coverage: No');
    });
  });

  describe('Edge cases', () => {
    it('should handle empty input', () => {
      const input: ImpactAnalysisInput = {
        target: { name: 'isolated', file: 'isolated.ts' },
        callers: [],
        tests: [],
      };

      const result = analyzeImpact(input);

      expect(result.directCallers).toHaveLength(0);
      expect(result.transitiveCallers).toHaveLength(0);
      expect(result.hasTestCoverage).toBe(false);
      expect(result.riskScore).toBe(RISK_WEIGHTS.noTestCoveragePenalty);
    });

    it('should handle complexity from options when not in target', () => {
      const input: ImpactAnalysisInput = {
        target: { name: 'func', file: 'func.ts' },
        callers: [],
        tests: [{ name: 'test', file: 'test.ts' }],
      };

      const result = analyzeImpact(input, { complexity: 30 });

      expect(result.riskBreakdown.complexityContribution).toBe(RISK_WEIGHTS.highComplexityPenalty);
    });
  });
});
