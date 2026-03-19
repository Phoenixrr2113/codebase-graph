# CodeGraph — Plan (2026-03-19)

## Current State

### Search: MRR 0.956, S@1=94%, S@5=100%, median 310ms (stable across 3 runs)
- Pipeline: Voyage code-3 embeddings → FalkorDB HNSW → Jina reranker-v3
- Pure reranker scoring (no manual text matching, no NODE_TYPE_BOOST)
- Embedding text: signature + modifiers + docstring + body snippet (300 chars) + file path
- Graph: 2817 nodes (dropped 4369 non-exported variables, 60% smaller)
- Clean 3-layer chain: MCP tool → codeGraphService.search() → enrichedSearchV2()
- Environment validation in benchmark/reindex scripts (driver bug caught and fixed)

### MCP Tools: SIMPLIFIED ✅
- 4 persona tools: search (find + context), knowledge (store + recall), codebase, query
- Search: 3-layer chain, calls enrichedSearchV2 directly
- Knowledge: 2 actions with auto-detection (routes to 7 handlers internally)
- Router: consolidated.ts → router.ts
- Deleted: repoMap.ts, SearchRegistry, strategy wrappers, 4 dead service methods

### Infrastructure
- FalkorDB (Docker) + FalkorDBLite (embedded local)
- 14 packages, pnpm + Turbo monorepo
- 7 language plugins + 34 generic configs (41 languages total)
- Providers configurable: embedding (voyage/local), reranker (jina/voyage), LLM (cerebras/openrouter)
- File watcher wired up for auto-reindex on changes

---

## Phase 1: MCP Simplification — DONE ✅

- Stripped search: 6 layers → 3 layers (MCP → service → enrichedSearchV2)
- Deleted: SearchRegistry, strategy wrappers, 4 dead service methods, repoMap.ts
- Renamed: consolidated.ts → router.ts
- Simplified knowledge persona: 8 actions → store + recall with auto-detection
- Removed map action from search persona
- Updated: CLI, API routes, benchmark
- Remaining: trace knowledge chain for indirection, clean up dead types/exports

---

## Phase 2: Codebase-Wide Deep Dive — DONE ✅

Audited all packages with 5 parallel agents. Results:

### Deleted entirely:
- **packages/api/** — old REST API, zero consumers (-2,800 lines)
- **packages/web/** — old dashboard, zero consumers, build broken (-5,400 lines)
- **core/src/pipeline/{task,runner,pipeline-tasks,types}.ts** — unused orchestration layer (-820 lines)

### Dead exports removed:
- **services/types.ts** — 18 dead interfaces (analysis module remnants)
- **services/graph-data-service.ts** — `deleteFileEntitiesImpl` (deprecated)
- **services/helpers.ts** — `CODE_LABELS` (unused)
- **operations.ts** — 2 dead methods + Cypher templates
- **knowledge-operations.ts** — 8 dead methods + Cypher templates
- **pipeline/pipeline.ts** — 7 dead exports (deprecated language helpers)
- **pipeline/parser.ts** — 2 dead exports
- **plugin-common/index.ts** — `emptyEntities`
- **core/src/index.ts** — 25+ dead re-exports cleaned

### Kept (all alive):
- plugin-nlp — all files needed (search infra + knowledge pipeline)
- plugin-common — used by 7 language plugins
- pipeline/{pipeline,parser,registry}.ts — indexer uses all
- services/{search-service,graph-data-service,helpers,types}.ts — used by MCP + service layer

---

## Phase 3: Enrich Search Response

### Response enrichment (surface what's already in the graph):
1. **Properties** — `properties` field returns `{}` for most hits. Surface: isExported, isAsync, params, returnType, complexity, cognitiveComplexity, loc
2. **Graph signals** — callerCount, callees (top 5), importerCount, containingFile, testReferences
3. **Code snippet** — include ~5 lines around function signature so the agent understands without a second read call
4. **Docstring** — surface the function's docstring/JSDoc if it exists

### Ranking improvements:
5. **Richer reranker documents** — include params, returnType, callerCount, docstring in reranker input text
6. **Dynamic CODE_NODE_TYPES** — query graph for labels with vector indexes instead of hardcoded JS list
7. **Docstring in embedding text** — include docstring when generating embeddings at index time (helps semantic gap queries)

### Performance:
8. **Embedding cache** — ✅ DONE. LRU Map<cacheKey, vector> in embeddings.ts (cloud providers only, local ~10ms not worth caching). Research showed full result caches have near-zero hit rate for developer tools — embedding-only cache is the industry standard.
9. **Cold start warmup** — ✅ DONE. Pre-warm on MCP server start.

### Additional graph signals (one at a time, benchmark each):
10. Test coverage (does a test file reference this?)
11. Change recency / churn (git metadata)
12. Dependency depth (Cypher path query)

---

## Phase 4: Fix Remaining Weak Query

One query below MRR 1.0:
- "how does indexing work" → MRR 0.25 (expects `indexProject`, gets `IndexingDemo` landing page component)

Root cause: query is a natural language question, and the landing page literally has a "How It Works" section. This is arguably correct behavior — the search found the most textually relevant result. The fix may be to improve the benchmark query rather than the search.

Previous weak query "graph database connection" → now MRR 1.0 (body snippet in embeddings helped bridge the semantic gap).

## Phase 4.5: FalkorDBLite Support

Get FalkorDBLite working so users don't need Docker:
- Install redis-server (`brew install redis`)
- Fix driver detection: FALKORDB_HOST/URL env vars should override auto-detection
- Test indexing + search with FalkorDBLite driver
- Ensure vector indexes work identically
- Update docs with setup instructions for both modes

---

## Phase 5: Competitive Benchmarking

### Approach (inspired by Cognee + Greptile benchmarks)
Build a code search benchmark similar to Cognee's evaluation methodology:
- 50+ realistic queries across 3-5 open source repos (not just our own)
- Mix of exact-name (40%), conceptual (40%), and multi-hop (20%) queries
- Multiple runs per system for statistical stability
- Open-source the dataset and eval script

### Metrics
- MRR, S@1, S@5 (search quality)
- Latency (p50, p95)
- Token cost (input tokens consumed)
- Setup complexity (time to first search)

### Competitors to benchmark against:

**Code Search:**
- Greptile MCP — cloud-based, indexes repos, MCP server for agents
- Sourcegraph Cody MCP — code search + navigation
- mcp-vector-search — generic vector MCP
- Repomix / code2prompt — context packing (no search, baseline)

**Knowledge / Memory:**
- OpenViking — context database for AI agents (LoCoMo benchmark)
- Cognee — knowledge graph with HotPotQA eval
- MemO, Graphiti, LightRAG — memory frameworks

### Test Repos (diverse languages/sizes)
- TypeScript: Cal.com (~500 files)
- Python: Sentry (~2000 files)
- Go: Grafana (~3000 files)
- Small: our own codebase (~340 files)

### Deliverables
- Public benchmark dataset (queries + expected results)
- Eval script that runs any MCP tool
- Results table for landing page
- Blog post / writeup

---

## Phase 6: Generic Plugin Migration — DONE ✅

### Tier 1: Java, C#, PHP → plugin-languages configs ✅
Moved 3 dedicated plugin packages into `plugin-languages/src/configs/` as config files with override functions.
- Deleted: `packages/plugin-java/`, `packages/plugin-csharp/`, `packages/plugin-php/` (3 packages)
- Added: `configs/java.ts`, `configs/csharp.ts`, `configs/php.ts` in plugin-languages
- Grammar loader updated to support `grammarTransform` (PHP exports `{ php, php_only }`)
- Tree-sitter grammars moved from individual packages to plugin-languages dependencies
- Pipeline.ts updated: Java/C#/PHP now register via `registerTier2Languages()`

### Tier 2+3: Python, Rust, Go, TypeScript — kept as dedicated packages ✅
Research showed these cannot be consolidated:
- **Python**: `resolvePythonImport()` hard-coded in pipeline.ts, 4 custom extractors
- **Rust**: 811 lines of impl-block traversal, 4 import patterns, trait bounds
- **Go**: method receivers, pointer unwrapping, struct/interface disambiguation
- **TypeScript**: 2,400 lines, JSX/React extractors, single-pass optimization, import resolution

---

## Phase 7: Packaging — DONE ✅

### npm private package setup ✅
- Added `"private": true` and `"bin"` config to mcp-server package.json
- Added `#!/usr/bin/env node` shebang to entry point
- Updated README with Claude Desktop and Claude Code setup instructions

### Distribution strategy (research-informed):
1. **npm + npx** (primary) — standard MCP distribution, handles native deps naturally
2. **Desktop Extension (.mcpb)** — future: one-click install for Claude Desktop
3. **Docker image** — future: sidesteps all native dependency issues
4. **Bun binary** — deferred: tree-sitter has open Bun issues, WASM modules don't bundle
5. **Polar.sh** — deferred: not needed until commercial tier

---

## Benchmark History

| Date | Config | MRR | S@1 | S@5 | Latency | Notes |
|------|--------|-----|-----|-----|---------|-------|
| 03-19 | **Body in embeddings + driver fix** | **0.956** | **94%** | **100%** | 310ms | Stable (3 runs identical), 2817 nodes |
| 03-19 | Driver fix, no body | 0.956 | 94% | 100% | 324ms | Confirmed: previous MRR drops were driver bug |
| 03-19 | ⚠️ Wrong driver (falkordblite) | 0.735 | 71% | 76% | 279ms | Driver bug — querying wrong database |
| 03-18 | V2 + Jina v3 | 0.905 | 86% | 95% | 427ms | 7228 nodes, 22 queries |
| 03-18 | V2 + Jina v2 | 0.858 | 82% | 86% | 401ms | |
| 03-18 | V2 + Voyage rerank-2 | 0.808 | 73% | 95% | 394ms | |
| 03-18 | V1 ENRICHED | 0.802 | 73% | 91% | 213ms | |
| 03-18 | HYBRID (deleted) | 0.619 | 55% | 77% | 329ms | Removed — V2 is the only search |
