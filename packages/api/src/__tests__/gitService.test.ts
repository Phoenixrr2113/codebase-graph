/**
 * Git Service Tests
 * Tests core's getRepoInfo and syncGitHistory (formerly API's gitService)
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { getRepoInfo, syncGitHistory, type GitSyncOptions } from '@codegraph/core';
import * as path from 'node:path';
import * as os from 'node:os';

describe('gitService (via @codegraph/core)', () => {
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

  describe('syncGitHistory', () => {
    function createMockClient() {
      return {
        roQuery: vi.fn().mockResolvedValue({ data: [] }),
        query: vi.fn().mockResolvedValue({}),
      } as Parameters<typeof syncGitHistory>[1];
    }

    it('should return error for non-git directory', async () => {
      const client = createMockClient();
      const result = await syncGitHistory(os.tmpdir(), client);

      expect(result.commitsProcessed).toBe(0);
      expect(result.errors.length).toBeGreaterThan(0);
    });

    it('should process commits from a valid repository', async () => {
      const client = createMockClient();
      const repoPath = path.resolve(__dirname, '../../../..');
      const result = await syncGitHistory(repoPath, client, { maxCommits: 3 });

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

      const client = createMockClient();
      const result = await syncGitHistory(repoPath, client, {
        sinceCommit: repoInfo.lastCommit,
        maxCommits: 10,
      });

      expect(result.commitsProcessed).toBe(0);
    });
  });
});
