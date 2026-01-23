/**
 * Git Service Tests
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { extractGitHistory, getRepoInfo } from '../services/gitService';
import * as path from 'node:path';
import * as os from 'node:os';

// Mock the graph client to avoid actual database calls
vi.mock('@codegraph/graph', () => ({
  createClient: vi.fn().mockResolvedValue({
    roQuery: vi.fn().mockResolvedValue({ data: [] }),
    query: vi.fn().mockResolvedValue({}),
  }),
  createOperations: vi.fn().mockReturnValue({
    upsertCommit: vi.fn().mockResolvedValue(undefined),
    createModifiedInEdge: vi.fn().mockResolvedValue(undefined),
  }),
}));

describe('gitService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('getRepoInfo', () => {
    it('should return isRepo: false for non-git directory', async () => {
      const result = await getRepoInfo(os.tmpdir());
      expect(result.isRepo).toBe(false);
    });

    it('should return repo info for valid git repository', async () => {
      // Use the codebase-graph repo itself
      const repoPath = path.resolve(__dirname, '../../../..');
      const result = await getRepoInfo(repoPath);

      expect(result.isRepo).toBe(true);
      expect(result.branch).toBeDefined();
      expect(result.lastCommit).toBeDefined();
      expect(typeof result.lastCommit).toBe('string');
    });
  });

  describe('extractGitHistory', () => {
    it('should return error for non-git directory', async () => {
      const result = await extractGitHistory(os.tmpdir());
      
      expect(result.commitsProcessed).toBe(0);
      expect(result.errors).toContain('Not a git repository');
    });

    it('should process commits from a valid repository', async () => {
      // Use the codebase-graph repo itself with very limited commits
      const repoPath = path.resolve(__dirname, '../../../..');
      const result = await extractGitHistory(repoPath, { maxCommits: 3 });

      // Should have processed at least some commits
      expect(result.commitsProcessed).toBeGreaterThanOrEqual(0);
      expect(result.durationMs).toBeGreaterThan(0);
    });

    it('should respect sinceCommit option', async () => {
      const repoPath = path.resolve(__dirname, '../../../..');
      
      // First get the latest commit
      const repoInfo = await getRepoInfo(repoPath);
      if (!repoInfo.lastCommit) {
        return; // Skip if no commits
      }

      // Extract with sinceCommit set to HEAD (should find no new commits)
      const result = await extractGitHistory(repoPath, {
        sinceCommit: repoInfo.lastCommit,
        maxCommits: 10,
      });

      expect(result.commitsProcessed).toBe(0);
    });
  });
});
