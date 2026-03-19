# CodeGraph — Plan (2026-03-19)

## Current State

### Search: MRR 0.931, S@1=88%, S@5=100%, median 301ms
- Pipeline: Voyage code-3 embeddings → FalkorDB HNSW → Jina reranker-v3
- Pure reranker scoring (no manual text matching, no NODE_TYPE_BOOST)
- Graph: 2859 nodes (dropped 4369 non-exported variables, 60% smaller)

### MCP Tools: NOT YET SIMPLIFIED
- 8 tool files + consolidated router, 4 personas
- Knowledge has 8 actions (should be 2: store + recall)
- Search persona has map action (should be removed)
- configureProjects exposed as MCP tool (should be setup/CLI only)

### Infrastructure
- FalkorDB (Docker) + FalkorDBLite (embedded local)
- 14 packages, pnpm + Turbo monorepo
- 7 language plugins + 34 generic configs (41 languages total)
- Providers configurable: embedding (voyage/local), reranker (jina/voyage), LLM (cerebras/openrouter)
- File watcher wired up for auto-reindex on changes

---

## Phase 1: Simplify MCP Server (NEXT)

### What the MCP server actually needs from core:
- `enrichedSearchV2()` — the search (called directly, NOT through service routing)
- `knowledgeService` — store/recall knowledge
- `indexProject()` / `indexSingleFile()` — indexing
- `getGraphClient()` — raw Cypher escape hatch
- `loadConfig()` / `setActiveProjects()` / `needsSetup()` — project setup
- `WatchService` — auto-reindex on file changes
- `readSourceFile()` — read source code
- `codeGraphService.getFileSubgraph()` / `getEntityWithConnections()` — context

### Target MCP tool surface:

| Tool | Action | Core function called | LLM? |
|------|--------|---------------------|------|
| **search** | find | `enrichedSearchV2()` | No (reranker API only) |
| **search** | context | `getFileSubgraph()`, `getEntityWithConnections()` | No |
| **knowledge** | store | `storeEntity()`, `storeRelationship()` | No |
| **knowledge** | store (extract) | `storeFact()`, `ingestConversation()` | Yes (LLM) |
| **knowledge** | recall | `queryKnowledge()`, `recall()` | No |
| **codebase** | configure | `setActiveProjects()`, `getProjects()` | No |
| **codebase** | reindex | `indexProject()` | No |
| **codebase** | status/stats | `getGraphStats()`, `getIndexSummary()` | No |
| **codebase** | source | `readSourceFile()` | No |
| **query** | (raw) | `getGraphClient().roQuery()` | No |

### Files to change:
1. Rename `consolidated.ts` → `router.ts`
2. Rewrite `searchCode.ts` — call `enrichedSearchV2()` directly instead of routing through 3 strategies
3. Simplify `knowledge.ts` — collapse 8 actions into `store` + `recall` with auto-detection
4. Delete `repoMap.ts`
5. Update search persona — remove `map` action, simplify `find` to use enrichedSearchV2 directly
6. Update knowledge persona — 2 actions instead of 8
7. Keep `codebase` persona as-is (configure, reindex, status, stats, source, ping)
8. Keep `query` persona as-is (raw Cypher)

---

## Phase 2: Enrich Search Response

### To do:
1. **Cache layer** — in-memory Map, invalidate on reindex or TTL (5 min), skip API calls on repeat queries
2. **Richer reranker documents** — include params, returnType, callerCount in reranker input text
3. **Dynamic CODE_NODE_TYPES** — query graph for labels with vector indexes instead of hardcoded list
4. **More graph signals** (one at a time, benchmark each):
   - Test coverage (does a test file reference this?)
   - Change recency / churn (git metadata)
   - Dependency depth (Cypher path query)

---

## Phase 3: Fix Remaining Weak Queries

Two queries below MRR 1.0:
- "graph database connection" → MRR 0.33 (semantic gap → expects `getGraphClient`)
- "how does indexing work" → MRR 0.50 (expects `indexProject`, gets `IndexStats`)

Diagnose: pool miss vs ranking miss. Fix accordingly.

---

## Phase 4: Competitive Benchmarking

Research and benchmark against:
- OpenViking (context database for AI agents)
- Greptile (code search MCP)
- Sourcegraph Cody (code context)
- Continue.dev (code context for LLMs)

Add results to landing page.

---

## Phase 5: Generic Plugin Migration

Migrate 7 dedicated language plugins → generic configs + overrides.
Delete 7 plugin packages (~5,400 lines → ~1,200 lines of configs).

---

## Phase 6: Packaging

- Bun binary compilation (`bun build --compile`)
- Polar.sh license integration
- npm distribution

---

## Benchmark History

| Date | Config | MRR | S@1 | S@5 | Latency | Notes |
|------|--------|-----|-----|-----|---------|-------|
| 03-19 | V2 + Jina v3 (no unexported vars) | **0.931** | 88% | 100% | 301ms median | 2859 nodes, 17 queries |
| 03-18 | V2 + Jina v3 | 0.905 | 86% | 95% | 427ms | 7228 nodes, 22 queries |
| 03-18 | V2 + Jina v2 | 0.858 | 82% | 86% | 401ms | |
| 03-18 | V2 + Voyage rerank-2 | 0.808 | 73% | 95% | 394ms | |
| 03-18 | V1 ENRICHED | 0.802 | 73% | 91% | 213ms | |
| 03-18 | HYBRID | 0.619 | 55% | 77% | 329ms | |
