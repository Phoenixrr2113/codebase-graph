# CodeGraph — Plan (2026-03-19)

## Current State

### Search: MRR 0.931, S@1=88%, S@5=100%, median 301ms
- Pipeline: Voyage code-3 embeddings → FalkorDB HNSW → Jina reranker-v3
- Pure reranker scoring (no manual text matching, no NODE_TYPE_BOOST)
- Graph: 2859 nodes (dropped 4369 non-exported variables, 60% smaller)
- Clean 3-layer chain: MCP tool → codeGraphService.search() → enrichedSearchV2()

### MCP Tools: PARTIALLY SIMPLIFIED
- Search: ✅ stripped from 6 layers to 3, calls enrichedSearchV2 directly
- Knowledge: ❌ still 8 actions (need: store + recall)
- consolidated.ts: ❌ still needs rename to router.ts
- repoMap.ts: ❌ still exists (dead weight)
- Search persona `map` action: ❌ still exists

### Infrastructure
- FalkorDB (Docker) + FalkorDBLite (embedded local)
- 14 packages, pnpm + Turbo monorepo
- 7 language plugins + 34 generic configs (41 languages total)
- Providers configurable: embedding (voyage/local), reranker (jina/voyage), LLM (cerebras/openrouter)
- File watcher wired up for auto-reindex on changes

---

## Phase 1: Finish MCP Simplification

### 1a. Done ✅
- Stripped search: 6 layers → 3 layers (MCP → service → enrichedSearchV2)
- Deleted: SearchRegistry, strategy wrappers, 4 dead service methods
- Updated: CLI, API routes, benchmark

### 1b. Remaining
1. Rename `consolidated.ts` → `router.ts`
2. Simplify knowledge persona: 8 actions → store + recall (auto-detect entity/relationship/fact/conversation)
3. Delete `repoMap.ts`, remove `map` action from search persona
4. Trace knowledge chain like we did search — find and strip indirection
5. Clean up dead types/exports from core/index.ts

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

1. **Cache layer** — in-memory Map, invalidate on reindex or TTL (5 min)
2. **Richer reranker documents** — include params, returnType, callerCount
3. **Dynamic CODE_NODE_TYPES** — query graph for labels with vector indexes
4. **More graph signals** (one at a time, benchmark each):
   - Test coverage, change recency, dependency depth

---

## Phase 4: Fix Remaining Weak Queries

Two queries below MRR 1.0:
- "graph database connection" → MRR 0.33 (semantic gap → expects `getGraphClient`)
- "how does indexing work" → MRR 0.50 (expects `indexProject`, gets `IndexStats`)

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
| 03-19 | Post-cleanup (3-layer chain) | **0.931** | 88% | 100% | 301ms median | Same as before, zero regression |
| 03-19 | V2 + Jina v3 (no unexported vars) | **0.931** | 88% | 100% | 301ms median | 2859 nodes, 17 queries |
| 03-18 | V2 + Jina v3 | 0.905 | 86% | 95% | 427ms | 7228 nodes, 22 queries |
| 03-18 | V2 + Jina v2 | 0.858 | 82% | 86% | 401ms | |
| 03-18 | V2 + Voyage rerank-2 | 0.808 | 73% | 95% | 394ms | |
| 03-18 | V1 ENRICHED | 0.802 | 73% | 91% | 213ms | |
| 03-18 | HYBRID | 0.619 | 55% | 77% | 329ms | |
