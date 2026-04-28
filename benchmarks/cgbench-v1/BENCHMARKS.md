# CGBench v1 — Results

> **v0.1.0 — smoke fixture only.** Numbers below are from the 3-file TypeScript smoke fixture
> + 10 knowledge/document docs bundled in the repo. Statistical confidence is low (n=3 questions, Task A only).
> v0.1.2 (next release) will publish real-corpus numbers against the 4 OSS corpora pinned in `corpora/code/manifest.json` and the full Task A–F question set.
>
> **Plan 5 status (2026-04-28):** cognee adapter unblocked (works in standalone smoke against this fixture
> via local Ollama at `http://localhost:11434/v1` with `qwen3.5:9b`). Cognee not yet shown in the table
> below because batch run-all integration crashes natively on `libc++ mutex` — the standalone smoke is
> reproducible; the orchestrator integration is a known v0.1.2 work item. Real-corpus codegraph run
> against zod also deferred — `enrichedSearchV2` hangs at first query on the 8K-entity zod graph;
> needs profiling.

**Run timestamp:** 2026-04-28T14:43:04.958Z
**Corpus:** smoke fixture (`fixtures/code/tiny-ts`, `corpora/knowledge`, `documents/source`)
**Systems tested:** codegraph, mcp-codebase-index, mempalace
**Working but excluded from this batch:** cognee (batch crash; standalone smoke passes)
**Deferred (no API key / Docker):** supermemory, hindsight, mastra-memory, augment

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
- supermemory (requires SUPERMEMORY_API_KEY), hindsight (requires HINDSIGHT_URL): READY-WITH-KEY but excluded from this run.
- cognee: WORKING in standalone smoke (local Ollama, qwen3.5:9b); excluded from this batch due to a native `libc++ mutex` crash in the run-all orchestrator integration. Standalone results: returns ranked code matches for fixture queries (e.g. `retry.ts#retry.ts` for "function that retries failed requests").
- mastra-memory, augment: DEFERRED stubs — see COMPETITORS.md.
- v0.1.2 will (a) fix cognee batch integration, (b) profile the codegraph zod-corpus query hang at `enrichedSearchV2`, (c) run against the 4 OSS corpora with the full question set.

---

## Methodology

- See `benchmarks/cgbench-v1/README.md` for setup
- See `benchmarks/cgbench-v1/COMPETITORS.md` for system status
- See `benchmarks/cgbench-v1/questions/REVIEW.md` for question authoring discipline
- Benchmark framework: custom TypeScript harness (`benchmarks/cgbench-v1/src/`)
- Scoring: MRR (reciprocal rank of first gold hit), Recall@K, Precision@K, F1, EM
- Latency: wall-clock per query including network/subprocess overhead; first N queries marked cold
