# CodeGraph — Plan (2026-03-18)

## Current State

### Search: MRR 0.944, S@1=90%, S@5=100%, ~400ms
- Pipeline: Voyage code-3 embeddings → FalkorDB HNSW → Jina reranker-v3 → graph enrichment
- 2 strategies: ENRICHED_V2 (primary), HYBRID (fallback)
- Response includes: name, nodeType, score, filePath, isExported, isAsync, complexity, cognitiveComplexity, callerCount, callees, importerCount

### MCP Tools: 8 files in tools/, 5 personas
- searchCode, getContext, repoMap, knowledge (8 actions), reindex, configureProjects, queryGraph, consolidated (router)

### Infrastructure
- FalkorDB (Docker) + FalkorDBLite (embedded local)
- 14 packages, pnpm + Turbo monorepo
- 7 dedicated language plugins + 34 generic configs (41 languages total)
- Providers configurable: embedding (voyage/local), reranker (jina/voyage), LLM (cerebras/openrouter)

---

## Phase 1: Simplify MCP Tool Surface

**Target: 5 tools (down from 8 + consolidated router)**

| Tool | Purpose |
|------|---------|
| **search** | Find code (ENRICHED_V2) |
| **context** | Understand code (relationships, source, graph traversal) |
| **store** | Put knowledge in the graph (entities, facts, conversations) |
| **recall** | Get knowledge out (semantic search across entities) |
| **query** | Raw Cypher escape hatch |

### Changes:
1. Rename `consolidated.ts` → `router.ts`
2. Move `configureProjects` + `reindex` to CLI/config only (not MCP tools)
3. Delete `repoMap.ts` — agent gets this from context or query
4. Refactor `knowledge.ts` — collapse 8 actions into `store` + `recall`
   - `decay_and_prune` → operational (runs on schedule/reindex)
   - `stats` → diagnostics (part of status check)
5. Update personas to match

---

## Phase 2: Enrich Search Response

### Done:
- Node properties: isExported, isAsync, complexity, cognitiveComplexity, loc, endLine
- Graph enrichment: callerCount, callees, importerCount (~20ms batch query)

### To do:
1. **Cache layer** — in-memory Map, invalidate on reindex or TTL (5 min), skip API calls on repeat queries
2. **Richer reranker documents** — include params, returnType, callerCount in reranker input text. Benchmark before/after.
3. **Dynamic CODE_NODE_TYPES** — query graph for labels with vector indexes instead of hardcoded JS-specific list
4. **More graph signals** (one at a time, benchmark each):
   - Test coverage (does a test file reference this?)
   - Change recency / churn (git metadata)
   - Dependency depth (Cypher path query)

---

## Phase 3: Fix Remaining Weak Queries

Two queries below MRR 1.0:
- "graph database connection" → MRR 0.33 (semantic gap → expects `getGraphClient`)
- "refactoring suggestions" → MRR 0.50

Diagnose: pool miss vs ranking miss. Fix accordingly.

---

## Phase 4: Generic Plugin Migration (from v5 FEAT.8)

Migrate 7 dedicated language plugins → generic configs + overrides. Delete 7 plugin packages (~5,400 lines → ~1,200 lines of configs).

- Phase 2a: Migrate Go, Java, C# (config tuning + minor overrides)
- Phase 2b: Migrate Rust, PHP (config + custom override callbacks)
- Phase 2c: Migrate TypeScript (needs extractComponents, multi-grammar dispatch)
- Phase 3: Delete 7 plugin-* packages, update pipeline.ts

---

## Phase 5: Evaluation Suite

Build benchmark/eval infrastructure:
- Rewrite for current strategies (ENRICHED_V2, HYBRID only)
- Security red-team tests (Cypher injection, prompt injection)
- Search quality regression tests (run on PR)
- MCP tool functional tests (store → recall cycle, search accuracy)

---

## Phase 6: Future (Low Priority)

- **LLM chunk summarization** — 2-sentence summaries per code entity during indexing
- **Portable graph snapshots** — pre-built indexes for CI/CD and team onboarding
- **Per-project/branch indexing** — branch-scoped graphs
- **Neo4j / Memgraph drivers** — database driver expansion
- **.NET / Sitecore support** — deferred

---

## Config
```bash
CODEGRAPH_EMBEDDING_PROVIDER=voyage
VOYAGE_API_KEY=...
CODEGRAPH_RERANK_PROVIDER=jina
CODEGRAPH_RERANK_MODEL=jina-reranker-v3
JINA_API_KEY=...
LLM_PROVIDER=cerebras
CEREBRAS_API_KEY=...
```

---

## Benchmark
| Strategy | MRR | S@1 | S@5 | Latency |
|----------|-----|-----|-----|---------|
| ENRICHED_V2 | 0.944 | 90% | 100% | 392ms |
| HYBRID | 0.648 | 57% | 81% | 478ms |
