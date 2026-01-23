/**
 * Change Detection Service Tests
 * Tests for hash-based change detection with rename support
 */

import { describe, it, expect } from 'vitest';
import {
  calculateFileHash,
  getFilesToProcess,
  getFilesToRemove,
  getRenamedFiles,
  hasChanges,
  formatChangeSummary,
  type ChangeSummary,
  type FileChange,
} from '../services/changeDetection';

describe('Change Detection', () => {
  describe('calculateFileHash', () => {
    it('should generate consistent hash for same content', () => {
      const content = 'const x = 1;';
      const hash1 = calculateFileHash(content);
      const hash2 = calculateFileHash(content);
      
      expect(hash1).toBe(hash2);
      expect(hash1.length).toBe(16); // Truncated SHA-256
    });

    it('should generate different hash for different content', () => {
      const hash1 = calculateFileHash('const x = 1;');
      const hash2 = calculateFileHash('const x = 2;');
      
      expect(hash1).not.toBe(hash2);
    });

    it('should handle empty content', () => {
      const hash = calculateFileHash('');
      
      expect(hash.length).toBe(16);
    });
  });

  describe('getFilesToProcess', () => {
    it('should return added, modified, and renamed files', () => {
      const summary: ChangeSummary = {
        totalFiles: 5,
        added: 1,
        modified: 1,
        deleted: 1,
        renamed: 1,
        unchanged: 1,
        changes: [
          { path: '/a.ts', type: 'added', hash: 'abc' },
          { path: '/b.ts', type: 'modified', hash: 'def' },
          { path: '/c.ts', type: 'deleted' },
          { path: '/d.ts', type: 'renamed', oldPath: '/old.ts', newPath: '/d.ts' },
        ],
      };

      const toProcess = getFilesToProcess(summary);
      
      expect(toProcess).toHaveLength(3);
      expect(toProcess.map(f => f.type)).toContain('added');
      expect(toProcess.map(f => f.type)).toContain('modified');
      expect(toProcess.map(f => f.type)).toContain('renamed');
      expect(toProcess.map(f => f.type)).not.toContain('deleted');
    });
  });

  describe('getFilesToRemove', () => {
    it('should return only deleted files', () => {
      const summary: ChangeSummary = {
        totalFiles: 3,
        added: 1,
        modified: 0,
        deleted: 1,
        renamed: 1,
        unchanged: 0,
        changes: [
          { path: '/a.ts', type: 'added' },
          { path: '/b.ts', type: 'deleted' },
          { path: '/c.ts', type: 'renamed', oldPath: '/old.ts' },
        ],
      };

      const toRemove = getFilesToRemove(summary);
      
      expect(toRemove).toHaveLength(1);
      expect(toRemove[0].type).toBe('deleted');
      expect(toRemove[0].path).toBe('/b.ts');
    });
  });

  describe('getRenamedFiles', () => {
    it('should return only renamed files', () => {
      const summary: ChangeSummary = {
        totalFiles: 3,
        added: 1,
        modified: 0,
        deleted: 0,
        renamed: 2,
        unchanged: 0,
        changes: [
          { path: '/a.ts', type: 'added' },
          { path: '/b.ts', type: 'renamed', oldPath: '/old1.ts', newPath: '/b.ts' },
          { path: '/c.ts', type: 'renamed', oldPath: '/old2.ts', newPath: '/c.ts' },
        ],
      };

      const renamed = getRenamedFiles(summary);
      
      expect(renamed).toHaveLength(2);
      expect(renamed.every(f => f.type === 'renamed')).toBe(true);
    });
  });

  describe('hasChanges', () => {
    it('should return true when files are added', () => {
      const summary: ChangeSummary = {
        totalFiles: 1,
        added: 1,
        modified: 0,
        deleted: 0,
        renamed: 0,
        unchanged: 0,
        changes: [],
      };

      expect(hasChanges(summary)).toBe(true);
    });

    it('should return true when files are modified', () => {
      const summary: ChangeSummary = {
        totalFiles: 1,
        added: 0,
        modified: 1,
        deleted: 0,
        renamed: 0,
        unchanged: 0,
        changes: [],
      };

      expect(hasChanges(summary)).toBe(true);
    });

    it('should return false when no changes', () => {
      const summary: ChangeSummary = {
        totalFiles: 5,
        added: 0,
        modified: 0,
        deleted: 0,
        renamed: 0,
        unchanged: 5,
        changes: [],
      };

      expect(hasChanges(summary)).toBe(false);
    });
  });

  describe('formatChangeSummary', () => {
    it('should format summary with all change types', () => {
      const summary: ChangeSummary = {
        totalFiles: 10,
        added: 2,
        modified: 3,
        deleted: 1,
        renamed: 1,
        unchanged: 3,
        changes: [],
      };

      const formatted = formatChangeSummary(summary);
      
      expect(formatted).toContain('2 added');
      expect(formatted).toContain('3 modified');
      expect(formatted).toContain('1 deleted');
      expect(formatted).toContain('1 renamed');
      expect(formatted).toContain('3 unchanged');
    });

    it('should return "No changes detected" when nothing changed', () => {
      const summary: ChangeSummary = {
        totalFiles: 0,
        added: 0,
        modified: 0,
        deleted: 0,
        renamed: 0,
        unchanged: 0,
        changes: [],
      };

      expect(formatChangeSummary(summary)).toBe('No changes detected');
    });
  });
});
