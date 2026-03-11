/**
 * Services exports
 */

export { parseProject, parseSingleFile, removeFileFromGraph } from './parseService';

// Re-export watch service from core (moved in Phase 1 consolidation)
export {
  WatchService,
  startWatching,
  stopWatching,
  getActiveWatcher,
  type FileChangeEvent,
  type FileEventType,
  type WatchServiceConfig,
} from '@codegraph/core';

// Re-export git from core (gitService.ts was a duplicate of core's gitSync)
export {
  syncGitHistory,
  getRepoInfo,
  type GitSyncResult,
  type GitSyncOptions,
} from '@codegraph/core';
