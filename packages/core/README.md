# @codegraph/core

Main orchestrator for CodeGraph. Provides the service layer that ties together parsing, search, embedding, and graph operations into a unified API.

## Overview

The core package is the central hub of CodeGraph. It re-exports key interfaces from `@codegraph/graph`, `@codegraph/types`, and `@codegraph/plugin-typescript`, and provides the high-level services that the MCP server and API consume.

## Key Modules

### Service Layer

- **`codeGraphService`** — Main service facade for search, graph traversal, entity access, project management
  - `search()` — Vector retrieval + cross-encoder reranking (enrichedSearchV2)
  - `getGraphStats()`, `getFullGraph()`, `getFileSubgraph()`, `getDependencyTree()`
  - `buildFileTree()`, `getIndexSummary()`, `getProjects()`, `deleteProject()`
  - `executeReadQuery()`, `getEntityWithConnections()`, `getNodesPaginated()`, `getNeighbors()`
- **`knowledgeService`** — Knowledge graph facade for entity/relationship/fact operations
  - `storeEntity()`, `storeRelationship()`, `storeFact()`, `recall()`
  - `getMemoryStats()`, `decayRelevance()`, `pruneStaleEntities()`

### Search

- **`enrichedSearchV2`** — Vector retrieval + cross-encoder reranking (the only active search strategy)
  - Pipeline: query → embed (Voyage code-3) → vector search → reranker (Jina reranker-v3) → graph enrichment

### Indexing

- **`indexProject`** — Full project indexing with incremental support, parallel processing, embeddings
- **`indexSingleFile`** — Index a single file
- **`isProjectIndexed`** — Check project indexing status

### Embedding

- **`embedParsedEntities`** — Embed newly parsed code entities during indexing
- **`embedAllParsedEntities`** — Batch embed multiple parsed results
- **`embedAllNodes`** — Retroactive bulk embedding for existing graph nodes

### Parsing Pipeline

- **`initParser` / `parseCode` / `parseFile` / `disposeParser`** — Tree-sitter parser lifecycle
- **`getLanguageForExtension`** — Resolve language plugin by file extension
- **`registerPlugins` / `registerTier2Languages`** — Register language plugins
- **`extractEntitiesForFile` / `buildParsedFileEntities`** — Entity extraction pipeline

### Configuration

- **`loadConfig` / `saveConfig`** — Read/write `~/.codegraph/mcp-context.json`
- **`getActiveProjectPaths`** — Manage which projects are indexed
- **`needsSetup` / `isStale`** — Setup and staleness detection

### Git Integration

- **`syncGitHistory`** — Import git commit history linked to code entities
- **`getRepoInfo`** — Repository metadata

### Utilities

- **`WatchService`** — File system watcher for live incremental updates
- **`readSourceFile`** — Read file content with line slicing and path traversal protection

## Usage

```typescript
import { codeGraphService, knowledgeService, indexProject } from '@codegraph/core';

// Index a project
await indexProject('/path/to/project', client);

// Search (returns { hits, meta })
const results = await codeGraphService.search('authentication');

// Knowledge operations
await knowledgeService.storeFact('The auth service uses OAuth2');
const recall = await knowledgeService.recall('auth service');
```

## Tests

3 test files:
- `config.test.ts` — Config load/save, setup detection, staleness, atomic writes
- `service.test.ts` — Service layer tests (needs update to match current API)
- `complexity.test.ts` — Complexity metrics (needs import path fix)

```bash
cd packages/core
pnpm exec vitest run
```
