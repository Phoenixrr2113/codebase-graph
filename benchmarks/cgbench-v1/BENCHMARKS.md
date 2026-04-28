# CGBench v1 — Results

> **v0.1.0 — smoke fixture only.**
> This release runs against the 3-file TypeScript smoke fixture and 10 knowledge/document
> docs bundled in the repo. Statistical confidence is low (n=3 questions per task).
> v0.1.1 will run against the 4 OSS corpora pinned in `corpora/code/manifest.json`
> and the full question set across all 6 tasks (A–F).

**Run timestamp:** 2026-04-28T14:43:04.958Z
**Corpus:** smoke fixture (`fixtures/code/tiny-ts`, `corpora/knowledge`, `documents/source`)
**Systems tested:** codegraph, mcp-codebase-index, mempalace
**Deferred (no API key / Docker):** supermemory, hindsight, cognee, mastra-memory, augment

Raw per-system JSON: [`results/v0.1.0-smoke/`](results/v0.1.0-smoke/)

---

## Quality

### Task A — NL→code retrieval
| System | MRR | Recall@10 |
|---|---|---|
| codegraph | 1.000 | 1.000 |
| mcp-codebase-index | 0.778 | 1.000 |
| mempalace | 0.000 | 0.000 |

**Notes:**
- **codegraph**: vector embeddings (nomic-embed-text-v1.5, local) + FalkorDBLite. MRR=1.000 on all 3 questions.
- **mcp-codebase-index**: regex/keyword retrieval. Recall@10=1.000 but MRR lower because lexical scoring doesn't rank the best match first.
- **mempalace**: 0 MRR because mempalace retrieves whole-file content units, not individual function symbols. Its result IDs (`retry.ts#retry.ts`) don't match the function-level gold IDs (`retry.ts#retry`). This is a fundamental limitation of file-level retrieval, not a scoring bug — expected and honest.

Tasks B–F not included in v0.1.0 smoke fixture (only `smoke.jsonl` / Task A questions exist).
v0.1.1 will run the full 6-task question suite.

---

## Latency (ms)
| System | p50 | p95 | p99 | mean |
|---|---|---|---|---|
| codegraph | 9 | 183 | 183 | 67 |
| mcp-codebase-index | 59 | 68 | 68 | 60 |
| mempalace | 861 | 871 | 871 | 848 |

**Notes:**
- codegraph p95=183ms is the model-load cold-start on query 1; p50=9ms for subsequent queries.
- mcp-codebase-index: steady ~60ms across all queries (regex search, no model loading).
- mempalace: ~850ms per query (Python subprocess + local sentence-transformer inference).

---

## Ingestion
| System | Duration (s) | Tokens/sec | Docs |
|---|---|---|---|
| codegraph | 0.752 | 12255 | 24 |
| mcp-codebase-index | 0.333 | 37538 | 1 |
| mempalace | 12.569 | 24767 | 15 |

---

## Caveats
- v0.1.0 is smoke-fixture only; n=3 questions, low statistical confidence — results demonstrate methodology, not production ranking.
- codegraph runs with local Hugging Face embeddings (no API keys required); no reranker (CODEGRAPH_RERANK_PROVIDER=none).
- mempalace MRR=0 reflects a fundamental file-vs-function granularity mismatch, not a retrieval failure.
- supermemory (requires SUPERMEMORY_API_KEY), hindsight (requires HINDSIGHT_URL), cognee, mastra-memory, augment: DEFERRED — see COMPETITORS.md.
- v0.1.1 will run against the 4 OSS corpora in `corpora/code/manifest.json` with the full question set (Tasks A–F).

---

## Methodology

- See `benchmarks/cgbench-v1/README.md` for setup
- See `benchmarks/cgbench-v1/COMPETITORS.md` for system status
- See `benchmarks/cgbench-v1/questions/REVIEW.md` for question authoring discipline
- Benchmark framework: custom TypeScript harness (`benchmarks/cgbench-v1/src/`)
- Scoring: MRR (reciprocal rank of first gold hit), Recall@K, Precision@K, F1, EM
- Latency: wall-clock per query including network/subprocess overhead; first N queries marked cold
