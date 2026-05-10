# CGBench v0.1.2 — CodeGraph on 4 OSS corpora

> **Honest single-system report.** This run measures CodeGraph in isolation
> across 4 real OSS codebases pinned in `corpora/code/manifest.json`. Numbers
> are reproducible — adapter is pure MCP, no invented capabilities. The run
> completed with **0 failures** across all 4 corpora and 4 × 28 = 112 question
> dispatches.
>
> **Not a competitive comparison.** Other systems' adapters (mempalace, cognee,
> mcp-codebase-index, etc.) were not audited the same way the codegraph adapter
> was; running them now would risk publishing numbers that misrepresent how a
> real user would invoke each tool. v0.1.3 will tackle that.

**Run timestamp:** 2026-05-10 (Eastern)
**Git SHA:** `737b017`
**Corpora:**

| Language | Repo | SHA / tag |
|---|---|---|
| TypeScript | colinhacks/zod | `ca3c8629` (v4.3.6) |
| Python | psf/requests | `111d2b77` (v2.33.1) |
| Go | go-chi/chi | `05f1ef7b` (v5.2.5) |
| Rust | clap-rs/clap | `ac5fda6a` (v4.6.1) |

---

## Configuration

| Layer | Provider | Model |
|---|---|---|
| Embeddings | Voyage (direct) | `voyage-code-3` (1024-dim) |
| Cross-encoder reranker | Voyage (direct) | `rerank-2` |
| LLM (entity extraction, structured output via tool calls) | CLIProxyAPI → Ollama Cloud | `qwen3-coder-next` |
| Graph DB | FalkorDB Docker | port 6380 |

The reindex tool blocks on code embeddings. Knowledge ingest blocks on entity
extraction + entity embedding + bridge linking. Queries only fire after both
ingestion phases return — confirmed by the 0-failure outcome.

---

## Quality

### Task A — NL → code retrieval

| Corpus | MRR | R@10 |
|---|---|---|
| TypeScript (zod) | **1.000** | 1.000 |
| Python (requests) | 0.500 | 0.667 |
| Go (chi) | **1.000** | 1.000 |
| Rust (clap) | 0.733 | 1.000 |

CodeGraph's vector + cross-encoder pipeline finds the right gold symbol at
rank 1 on TypeScript and Go corpora. Python lags noticeably (0.500 MRR) —
the gold is in the candidate pool (R@10 = 0.667) but ranked deeper. Rust
finds gold in top-10 every time but doesn't always rank it #1.

### Task B — multi-hop / structural

| Corpus | R@10 | P@5 |
|---|---|---|
| TypeScript | 0.500 | 0.267 |
| Python | 0.333 | 0.200 |
| Go | 0.333 | 0.133 |
| Rust | 0.000 | 0.000 |

**Vector-only retrieval, expected partial recall.** The cgbench adapter
deliberately routes B and C through `search.find` instead of inventing an
NL→Cypher capability CodeGraph doesn't claim. Multi-hop questions like
"functions that call X" or "classes that extend AuthBase" recover only
when vector similarity happens to surface the right answer — for full
structural traversal, real users call the `query` MCP tool with hand-written
Cypher (not exercised here).

### Task C — dependency / transitive impact

| Corpus | F1 |
|---|---|
| TypeScript | 0.000 |
| Python | 0.083 |
| Go | 0.000 |
| Rust | 0.000 |

**Vector-only — score collapses as expected.** "Functions transitively
affected if X changes" requires variable-length CALLS traversal. Same
honesty story as Task B.

### Task D — temporal recall (knowledge graph)

| Corpus | EM (point-in-time, n=5) | R@10 (range, n=3) |
|---|---|---|
| TypeScript | 0.800 | 0.444 |
| Python | 0.800 | 0.667 |
| Go | 0.800 | 0.333 |
| Rust | 1.000 | 0.000 |

Point-in-time recall is stable around 0.800 on three corpora and 1.000 on
Rust. The range-recall variance reflects that knowledge entities are
extracted by the LLM each ingest, and small differences in extracted entity
text affect range-window matching.

### Task E — cross-modal (code + knowledge linked via ABOUT edges)

| Corpus | R@10 (n=2) |
|---|---|
| TypeScript | 0.750 |
| Python | 0.583 |
| Go | 0.450 |
| Rust | 0.250 |

Cross-modal retrieval works — the cross-modal expansion in `unifiedSearch`
(2026-05-10 work) traverses ABOUT edges from top-ranked knowledge documents
to surface code symbols those documents reference. The corpus-by-corpus
variance reflects how well the LLM's extracted entity names happened to
match real code symbols in each language.

### Task F — document retrieval

| Corpus | R@10 (n=10) |
|---|---|
| TypeScript | 0.800 |
| Python | **1.000** |
| Go | 0.900 |
| Rust | 0.900 |

Document retrieval is strong across all corpora — 0.800–1.000 R@10.

---

## Latency (warm queries)

| Corpus | p50 | p95 | cold p50 |
|---|---|---|---|
| TypeScript | 196 ms | 2454 ms | 2375 ms |
| Python | 199 ms | 629 ms | 463 ms |
| Go | 186 ms | 488 ms | 481 ms |
| Rust | 191 ms | 1473 ms | 622 ms |

Warm p50 is consistent ~190 ms across all 4 corpora. p95 spikes are reranker
calls under load. Cold latency on TypeScript is high because cgbench's first
5 questions per corpus go through model warmup.

---

## Ingestion

| Corpus | Total docs | Duration |
|---|---|---|
| TypeScript | 21 | 424 s (~7 min) |
| Python | 21 | 387 s (~6.5 min) |
| Go | 21 | 630 s (~10.5 min) |
| Rust | 21 | 498 s (~8.5 min) |

Each "doc" is one code-corpus root (1) + 10 knowledge files + 10 fact files.
The variance is mostly in the LLM round-trip latency for entity extraction
across the knowledge files — Ollama Cloud's qwen3-coder-next is fast but not
deterministic in latency.

---

## Reproduce

```bash
# 1. Spin up cgbench FalkorDB
docker compose --profile bench up -d cgbench-falkordb

# 2. Render document variants (idempotent)
cd benchmarks/cgbench-v1 && pnpm bench:render-docs

# 3. Run all 4 corpora
/tmp/run-cgbench-real.sh   # see git history for the script
```

Required env (in repo `.env`):
```
LLM_PROVIDER=ollama
LLM_MODEL=ollama/qwen3-coder-next
OLLAMA_BASE_URL=http://127.0.0.1:18317/v1
OLLAMA_API_KEY=<cliproxy>
CODEGRAPH_EMBEDDING_PROVIDER=voyage
VOYAGE_API_KEY=<voyage>
CODEGRAPH_RERANK_PROVIDER=voyage
CODEGRAPH_RERANK_MODEL=rerank-2
```

---

## Caveats

- **Single-system report only.** Competitor adapters (mempalace, cognee,
  mcp-codebase-index, supermemory, hindsight) need the same audit treatment
  the CodeGraph adapter received before any cross-system claim is honest.
- **Single LLM run.** Different LLMs extract slightly different entity text,
  which propagates to Tasks D / E. Running with a stronger model (e.g.
  `ollama/gemma4` or `ollama/glm-5.1`) would likely shift Task E numbers.
- **Tasks B and C are deliberately weak.** The adapter routes them through
  vector retrieval (`search.find`); production users wanting structural
  multi-hop / transitive answers should call the `query` MCP tool with
  hand-written Cypher.
- **Task E n=2 per corpus.** Statistical noise floor is high.
- **Voyage embedding cost.** Estimated ≤ $5 for the full 4-corpus run; first
  200M tokens are free per Voyage's pricing.
