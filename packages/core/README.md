# @codegraph/core

Main orchestrator for CodeGraph. Provides the service layer that ties together parsing, analysis, search, embedding, and graph operations into a unified API.

## Overview

The core package is the central hub of CodeGraph. It re-exports key interfaces from `@codegraph/graph`, `@codegraph/types`, and `@codegraph/plugin-typescript`, and provides the high-level services that the MCP server and API consume.

## Key Modules

### Service Layer

- **`CodeGraphService`** — Main service facade for parsing, indexing, and querying codebases
- **`KnowledgeService`** — Knowledge graph facade for entity/relationship/fact operations

### Parsing Pipeline

- **`PipelineRunner`** — Orchestrates multi-language parsing with Task wrapper and provenance tracking
- **`initParser` / `parseCode` / `parseFile`** — Tree-sitter WASM parser initialization and code parsing
- **`SymbolRegistry`** — Two-pass resolution: collect symbols, then resolve cross-file relationships

### Search

- **`hybridSearch`** — Combined vector + text + graph traversal search
- **`SearchRegistry`** — Strategy pattern for pluggable search strategies
- **Strategies:**
  - `HybridSearchStrategy` — Vector + text + graph
  - `EnrichedV2Strategy` — Vector retrieval + cross-encoder reranking

### Analysis

- **Complexity** — Cyclomatic, cognitive, nesting depth metrics
- **Security** — OWASP Top 10 vulnerability scanning
- **Payment** — Payment-specific rules (Stripe, Adyen)
- **Impact** — Change impact analysis (callers, dependents, risk scoring)
- **Refactoring** — Extraction candidates, responsibility analysis
- **Dataflow** — Taint tracking from sources to sinks

### Embedding

- **`embedParsedEntities`** — Embed newly parsed code entities
- **`embedAllNodes`** — Bulk embed all nodes in the graph

### Configuration

- **`loadConfig` / `saveConfig`** — Read/write `.codegraph/config.json`
- **`syncConfigToGraph`** — Sync configuration state to graph database
- **`getActiveProjectPaths`** — Manage which projects are indexed

### Git Integration

- **`syncGitHistory`** — Import git commit history linked to code entities
- **`getRepoInfo`** — Repository metadata

### Utilities

- **`estimateTokens` / `truncateToTokenBudget`** — Token counting for LLM context management
- **`detectChanges` / `getFilesToProcess`** — Incremental indexing with change detection
- **`WatchService`** — File system watcher for live updates

## Usage

```typescript
import { codeGraphService, knowledgeService } from '@codegraph/core';

// Index a project
await codeGraphService.extract({ paths: ['/path/to/project'] });

// Search
const results = await codeGraphService.search('authentication');

// Analyze impact
const impact = await codeGraphService.analyzeImpact('processPayment');

// Knowledge operations
await knowledgeService.storeFact('The auth service uses OAuth2');
const recall = await knowledgeService.recall('auth service');
```

## Tests

21 test files covering:
- Service layer (indexing, search, analysis)
- Pipeline orchestration and runner
- All 6 analysis domains (complexity, security, payment, impact, refactoring, dataflow)
- Search registry and strategy routing
- Config sync and loading
- Hybrid search (FalkorDB integration)
- Token estimation
- E2E smoke tests and multi-language indexing

```bash
cd packages/core
pnpm exec vitest run
```
