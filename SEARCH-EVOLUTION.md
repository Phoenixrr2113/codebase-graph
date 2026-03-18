# Search Evolution — From 7 Strategies to 2

## The Story

CodeGraph started with 7 search strategies, most built by AI agents without human verification. This document traces how we stripped it down to 2 strategies that outperform all 7 combined.

## Where We Started (March 14, 2026)

7 search strategies:
- **HYBRID** — Vector + text + graph traversal
- **ENRICHED V1** — HYBRID + manual NLP enrichment signals
- **GRAPH_ANSWER** — Vector search → LLM synthesizes answer
- **NL_TO_CYPHER** — LLM translates natural language to Cypher
- **SMART_SEARCH** — LLM router that picks which strategy to use
- **CONTEXT_WALK** — Multi-round LLM graph exploration
- **ENRICHED_V2** — Started as a clean rewrite experiment

### Problems
1. **Manual NLP everywhere** — `splitIdentifier` (regex camelCase splitter), `extractTerms` (regex query parser), `STOP_WORDS` (hardcoded 100 words), `scoreTextMatch` (50 lines of fuzzy matching with magic numbers)
2. **LLM dependency** — 4 of 7 strategies needed LLM calls, adding 500-7000ms latency
3. **NL_TO_CYPHER was broken** — MRR 0.202, generated bad Cypher for most queries
4. **SMART_SEARCH was a router** — Added latency to classify, then dispatched to another strategy
5. **Agent-written code** — Hardcoded constants, JS-specific node types, untested assumptions

## The Simplification Process

### Phase 1: Strip V2 to bare minimum
**Goal:** query → vector search → reranker → response. Nothing else.

Removed from V2:
- `splitIdentifier` — regex camelCase splitter (~20 lines)
- `extractTerms` — regex query term extraction (~30 lines)
- `STOP_WORDS` — hardcoded list of ~100 English stop words
- `scoreTextMatch` — 50 lines of manual fuzzy string matching with 6 magic numbers
- `NODE_TYPE_BOOST` — manual weights (Function: 1.0, Variable: 0.40, etc.)

**Result:** MRR held steady. The manual NLP was dead weight — the reranker already did this better.

### Phase 2: Trust the reranker
Changed reranker blend from `0.60 * vectorScore + 0.40 * rerankerScore` to `1.0 * rerankerScore`.

**Reasoning:** The reranker is a cross-encoder that sees both query AND document. Vector cosine similarity encodes them separately. The reranker is strictly more informed.

**Result:** MRR held. The vector score was redundant.

### Phase 3: Upgrade reranker
Tested Jina reranker-v3 against Voyage rerank-2:

| Reranker | MRR | S@1 | S@5 |
|----------|-----|-----|-----|
| Voyage rerank-2 | 0.808 | 73% | 95% |
| Jina reranker-v2 | 0.858 | 82% | 86% |
| Jina reranker-v3 | 0.905 | 86% | 95% |

Jina v3 gave a massive jump. Made reranker provider configurable via env vars.

### Phase 4: Rewrite benchmark
The old benchmark had 21 essay-length queries like "load and save project config" — not how AI agents actually use search.

Rewrote with realistic queries in two modes:
1. **"I know what I want"** — `hybridSearch`, `parseCode`, `getGraphClient`
2. **"I'm exploring"** — `impact analysis`, `embedding generation`, `logging setup`

Verified every expected result exists in the codebase.

### Phase 5: Enrich responses
V2 was returning sparse results (name, score, filePath). The graph had much richer data already indexed.

**Added from existing node properties (free — already fetched):**
- `isExported`, `isAsync`, `complexity`, `cognitiveComplexity`, `loc`, `endLine`

**Added via batch graph query (~20ms):**
- `callerCount` — how many functions call this
- `callees` — what this function calls (top 5)
- `importerCount` — how many files import this

**Result:** MRR jumped to 0.944. S@5 hit 100%.

### Phase 6: Delete the losers
Final benchmark across all 7 strategies:

| Strategy | MRR | S@1 | S@5 | Latency | LLM? |
|----------|-----|-----|-----|---------|------|
| **ENRICHED_V2** | **0.944** | **90%** | **100%** | **392ms** | **No** |
| ENRICHED V1 | 0.836 | 76% | 95% | 227ms | No |
| CONTEXT_WALK | 0.706 | 62% | 81% | 7641ms | Yes |
| SMART_SEARCH | 0.671 | 62% | 71% | 1211ms | Yes |
| HYBRID | 0.648 | 57% | 81% | 478ms | No |
| GRAPH_ANSWER | 0.603 | 57% | 62% | 1155ms | Yes |
| NL_TO_CYPHER | 0.202 | 19% | 19% | 2433ms | Yes |

Deleted: ENRICHED V1, GRAPH_ANSWER, NL_TO_CYPHER, SMART_SEARCH, CONTEXT_WALK.
Kept: ENRICHED_V2 (primary), HYBRID (fallback).

## What We Learned

1. **Less code = better results.** Every manual NLP hack we removed either improved or maintained scores.
2. **Trust your tools.** The reranker (cross-encoder) already does text matching, type boosting, and fuzzy matching better than regex. Don't duplicate what it does.
3. **LLM ≠ better.** The 4 LLM-dependent strategies were all slower AND less accurate than the non-LLM V2.
4. **Verify agent output.** The original 7 strategies were built by AI agents without benchmarking. Half were broken or harmful.
5. **Benchmark first, optimize second.** Every change was benchmarked. Many "improvements" (importance signals, quality scores, adaptive blending) actually regressed scores and were reverted.
6. **Simplify the pipeline, enrich the response.** Instead of complex retrieval logic, we kept retrieval simple (vector search → reranker) and invested in response quality (graph enrichment).

## Architecture Now

```
User query
  ↓
Vector embeddings (Voyage code-3, ~50ms)
  ↓
Fan out across node types → FalkorDB HNSW (~100ms)
  ↓
60 candidates
  ↓
Cross-encoder reranker (Jina v3, ~200ms)
  ↓
Top 20 results
  ↓
Batch graph enrichment (callers, callees, importers, ~20ms)
  ↓
Enriched response (~400ms total)
```

## Config
```bash
# Embedding provider (vector search)
CODEGRAPH_EMBEDDING_PROVIDER=voyage  # or 'local' for nomic
VOYAGE_API_KEY=...

# Reranker provider
CODEGRAPH_RERANK_PROVIDER=jina       # or 'voyage'
CODEGRAPH_RERANK_MODEL=jina-reranker-v3
JINA_API_KEY=...
```

## Files Deleted
- `packages/core/src/enrichedSearch.ts` (V1, ~400 lines)
- `packages/core/src/search/strategies/enriched.ts`
- `packages/core/src/search/strategies/graphAnswer.ts`
- `packages/core/src/search/strategies/nlToCypher.ts`
- `packages/core/src/search/strategies/smartSearch.ts`
- `packages/core/src/search/strategies/contextWalk.ts`
- `packages/core/src/__tests__/search-registry.test.ts`
- 117 old benchmark result JSON files

## Next Steps (see SEARCH-ENRICHMENT-PLAN.md)
- Cache layer (query → response, invalidate on reindex)
- Richer reranker documents (include enrichment data in reranker input)
- Dynamic CODE_NODE_TYPES discovery (query graph for indexed labels)
- More graph signals: test coverage, change recency, author expertise
