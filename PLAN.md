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

## Phase 2: Codebase-Wide Deep Dive

Do the same analysis we did on search across the ENTIRE codebase:
- Trace every call chain from MCP tools through core to graph
- Identify layers of indirection, dead code, unused exports
- Map what each package actually does vs what it claims to do
- Use our own search tools to explore and validate

### Packages to audit:
| Package | Status | Notes |
|---------|--------|-------|
| core/src/services/ | ❌ | search-service.ts cleaned, graph-data-service.ts + helpers.ts + types.ts need audit |
| core/src/pipeline/ | ❌ | Is this all used by the indexer? Or dead? |
| graph/src/ | ❌ | operations.ts is huge — what's actually called? |
| plugin-nlp/src/ | ❌ | embeddings, reranker, LLM, bridge-linker — what's dead? |
| plugin-common/ | ❌ | complexity.ts was deleted but package still exists |
| api/ | ❌ | Do we even need this? MCP server is the primary interface |
| web/ (packages/web) | ❌ | Old dashboard, build broken, possibly delete entirely |

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
8. **Cache layer** — in-memory Map<queryHash, result>, invalidate on reindex or TTL (5 min), skip embedding + reranker API calls on repeat queries
9. **Cold start warmup** — first query is ~600ms (embedding model init). Pre-warm on MCP server start.

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

Research and benchmark against:
- OpenViking (context database for AI agents)
- Greptile (code search MCP)
- Sourcegraph Cody (code context)
- Continue.dev (code context for LLMs)

Add results to landing page.

---

## Phase 6: Generic Plugin Migration

Migrate 7 dedicated language plugins → generic configs + overrides.
Delete 7 plugin packages (~5,400 lines → ~1,200 lines of configs).

---

## Phase 7: Packaging

- Bun binary compilation (`bun build --compile`)
- Polar.sh license integration
- npm distribution

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
| 03-18 | HYBRID | 0.619 | 55% | 77% | 329ms | |
