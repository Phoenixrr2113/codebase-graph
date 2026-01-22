/**
 * Refactoring Analysis Tests
 * Tests for analyzing files for extraction opportunities
 */

import { describe, it, expect } from 'vitest';
import {
  analyzeRefactoring,
  classifyCouplingLevel,
  calculateCouplingScore,
  isSafeToExtract,
  getExtractionCandidatesQuery,
  getInternalCallsQuery,
  getExtractionOrder,
  getRefactoringSummary,
  needsRefactoring,
  DEFAULT_EXTRACTION_THRESHOLD,
  COUPLING_THRESHOLDS,
  RefactoringAnalysisInput,
} from '../analysis/refactoring';

describe('Refactoring Analysis', () => {
  describe('analyzeRefactoring', () => {
    it('should analyze functions and calculate coupling scores', () => {
      const input: RefactoringAnalysisInput = {
        file: 'src/utils.ts',
        functions: [
          { name: 'formatDate', startLine: 1, endLine: 10, internalCalls: 0, stateReads: 0 },
          { name: 'parseDate', startLine: 12, endLine: 20, internalCalls: 1, stateReads: 0 },
          { name: 'validateDate', startLine: 22, endLine: 35, internalCalls: 2, stateReads: 2 },
        ],
      };

      const result = analyzeRefactoring(input);

      expect(result.file).toBe('src/utils.ts');
      expect(result.totalFunctions).toBe(3);
      expect(result.functions[0].couplingScore).toBe(0);
      expect(result.functions[1].couplingScore).toBe(1);
      expect(result.functions[2].couplingScore).toBe(4);
    });

    it('should identify extraction candidates below threshold', () => {
      const input: RefactoringAnalysisInput = {
        file: 'src/helpers.ts',
        functions: [
          { name: 'helper1', startLine: 1, endLine: 5, internalCalls: 0, stateReads: 0 },
          { name: 'helper2', startLine: 7, endLine: 15, internalCalls: 1, stateReads: 1 },
          { name: 'complex', startLine: 17, endLine: 50, internalCalls: 3, stateReads: 2 },
        ],
      };

      const result = analyzeRefactoring(input);

      expect(result.extractionCandidates).toHaveLength(2); // helper1 and helper2
      expect(result.extractionCandidates[0].name).toBe('helper1');
      expect(result.extractionCandidates[1].name).toBe('helper2');
    });

    it('should calculate average and max coupling scores', () => {
      const input: RefactoringAnalysisInput = {
        file: 'src/service.ts',
        functions: [
          { name: 'fn1', startLine: 1, endLine: 10, internalCalls: 2, stateReads: 0 },
          { name: 'fn2', startLine: 12, endLine: 20, internalCalls: 4, stateReads: 2 },
        ],
      };

      const result = analyzeRefactoring(input);

      expect(result.averageCouplingScore).toBe(4); // (2 + 6) / 2
      expect(result.maxCouplingScore).toBe(6);
    });

    it('should respect custom extraction threshold', () => {
      const input: RefactoringAnalysisInput = {
        file: 'src/module.ts',
        functions: [
          { name: 'fn1', startLine: 1, endLine: 10, internalCalls: 4, stateReads: 0 },
          { name: 'fn2', startLine: 12, endLine: 20, internalCalls: 6, stateReads: 0 },
        ],
      };

      const result = analyzeRefactoring(input, { extractionThreshold: 5 });

      expect(result.extractionCandidates).toHaveLength(1);
      expect(result.extractionCandidates[0].name).toBe('fn1');
    });

    it('should detect responsibilities when call relationships provided', () => {
      const input: RefactoringAnalysisInput = {
        file: 'src/app.ts',
        functions: [
          { name: 'handleAuth', startLine: 1, endLine: 10, internalCalls: 1, stateReads: 0 },
          { name: 'validateToken', startLine: 12, endLine: 20, internalCalls: 0, stateReads: 0 },
          { name: 'processData', startLine: 22, endLine: 35, internalCalls: 0, stateReads: 0 },
        ],
        callRelationships: [
          { caller: 'handleAuth', callee: 'validateToken' },
        ],
      };

      const result = analyzeRefactoring(input, { detectResponsibilities: true });

      expect(result.responsibilities.length).toBeGreaterThanOrEqual(1);
    });

    it('should handle empty functions list', () => {
      const input: RefactoringAnalysisInput = {
        file: 'src/empty.ts',
        functions: [],
      };

      const result = analyzeRefactoring(input);

      expect(result.totalFunctions).toBe(0);
      expect(result.extractionCandidates).toHaveLength(0);
      expect(result.averageCouplingScore).toBe(0);
      expect(result.maxCouplingScore).toBe(0);
    });
  });

  describe('classifyCouplingLevel', () => {
    it('should classify low coupling', () => {
      expect(classifyCouplingLevel(0)).toBe('low');
      expect(classifyCouplingLevel(3)).toBe('low');
    });

    it('should classify medium coupling', () => {
      expect(classifyCouplingLevel(4)).toBe('medium');
      expect(classifyCouplingLevel(6)).toBe('medium');
    });

    it('should classify high coupling', () => {
      expect(classifyCouplingLevel(7)).toBe('high');
      expect(classifyCouplingLevel(15)).toBe('high');
    });
  });

  describe('calculateCouplingScore', () => {
    it('should sum internal calls and state reads', () => {
      expect(calculateCouplingScore(3, 2)).toBe(5);
      expect(calculateCouplingScore(0, 0)).toBe(0);
      expect(calculateCouplingScore(10, 5)).toBe(15);
    });
  });

  describe('isSafeToExtract', () => {
    it('should return true for low coupling', () => {
      expect(isSafeToExtract(0)).toBe(true);
      expect(isSafeToExtract(2)).toBe(true);
    });

    it('should return false for high coupling', () => {
      expect(isSafeToExtract(3)).toBe(false);
      expect(isSafeToExtract(10)).toBe(false);
    });

    it('should respect custom threshold', () => {
      expect(isSafeToExtract(4, 5)).toBe(true);
      expect(isSafeToExtract(5, 5)).toBe(false);
    });
  });

  describe('Cypher Query Generators', () => {
    it('should generate extraction candidates query', () => {
      const query = getExtractionCandidatesQuery('src/utils.ts');

      expect(query).toContain('MATCH');
      expect(query).toContain('File');
      expect(query).toContain('src/utils.ts');
      expect(query).toContain('internalCalls');
      expect(query).toContain('stateReads');
      expect(query).toContain('ORDER BY couplingScore');
    });

    it('should generate internal calls query', () => {
      const query = getInternalCallsQuery('src/module.ts');

      expect(query).toContain(':CALLS');
      expect(query).toContain('src/module.ts');
      expect(query).toContain('caller');
      expect(query).toContain('callee');
    });
  });

  describe('getExtractionOrder', () => {
    it('should sort by coupling score ascending', () => {
      const functions = [
        { name: 'high', file: 'f.ts', startLine: 1, endLine: 10, internalCalls: 5, stateReads: 3, couplingScore: 8, isExtractionCandidate: false },
        { name: 'low', file: 'f.ts', startLine: 12, endLine: 20, internalCalls: 0, stateReads: 1, couplingScore: 1, isExtractionCandidate: true },
        { name: 'medium', file: 'f.ts', startLine: 22, endLine: 30, internalCalls: 1, stateReads: 1, couplingScore: 2, isExtractionCandidate: true },
      ];

      const order = getExtractionOrder(functions);

      expect(order).toHaveLength(2);
      expect(order[0].name).toBe('low');
      expect(order[1].name).toBe('medium');
    });
  });

  describe('getRefactoringSummary', () => {
    it('should return formatted summary', () => {
      const input: RefactoringAnalysisInput = {
        file: 'src/test.ts',
        functions: [
          { name: 'fn1', startLine: 1, endLine: 10, internalCalls: 0, stateReads: 0 },
        ],
      };

      const result = analyzeRefactoring(input);
      const summary = getRefactoringSummary(result);

      expect(summary).toContain('src/test.ts');
      expect(summary).toContain('Total functions: 1');
      expect(summary).toContain('Extraction candidates: 1');
    });
  });

  describe('needsRefactoring', () => {
    it('should return true for high coupling', () => {
      const input: RefactoringAnalysisInput = {
        file: 'src/complex.ts',
        functions: [
          { name: 'fn1', startLine: 1, endLine: 10, internalCalls: 10, stateReads: 5 },
        ],
      };

      const result = analyzeRefactoring(input);

      expect(needsRefactoring(result)).toBe(true);
    });

    it('should return true for many functions', () => {
      const functions = Array.from({ length: 20 }, (_, i) => ({
        name: `fn${i}`,
        startLine: i * 10,
        endLine: i * 10 + 8,
        internalCalls: 0,
        stateReads: 0,
      }));

      const result = analyzeRefactoring({ file: 'big.ts', functions });

      expect(needsRefactoring(result)).toBe(true);
    });

    it('should return false for small well-structured file', () => {
      const input: RefactoringAnalysisInput = {
        file: 'src/simple.ts',
        functions: [
          { name: 'fn1', startLine: 1, endLine: 10, internalCalls: 1, stateReads: 0 },
          { name: 'fn2', startLine: 12, endLine: 20, internalCalls: 0, stateReads: 1 },
        ],
      };

      const result = analyzeRefactoring(input);

      expect(needsRefactoring(result)).toBe(false);
    });
  });

  describe('Constants', () => {
    it('should have correct default threshold', () => {
      expect(DEFAULT_EXTRACTION_THRESHOLD).toBe(3);
    });

    it('should have correct coupling thresholds', () => {
      expect(COUPLING_THRESHOLDS.low).toBe(3);
      expect(COUPLING_THRESHOLDS.medium).toBe(6);
    });
  });
});
