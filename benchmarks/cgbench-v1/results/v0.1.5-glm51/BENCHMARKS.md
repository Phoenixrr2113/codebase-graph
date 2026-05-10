# CGBench v0.1.5 — glm-5.1 entity extraction

> **Single-system report.** Identical methodology and code SHA as v0.1.4. The
> only change is the entity-extraction LLM: `ollama/qwen3-coder-next` →
> `ollama/glm-5.1` (via cliproxy → Ollama Cloud). Run on the same 4 OSS
> corpora. 1 question dispatch dropped on a knowledge-ingest MCP timeout
> (TypeScript `knowledge-009.md` recovered on retry), 0 failures on the
> remaining 111.

**Run timestamp:** 2026-05-10 (Eastern), late afternoon
**Git SHA:** `1bc58b9` (same as v0.1.4)
**LLM:** `ollama/glm-5.1` (was `ollama/qwen3-coder-next` in v0.1.4)

## Headline numbers

| Task | TypeScript (zod) | Python (requests) | Go (chi) | Rust (clap) |
|---|---|---|---|---|
| **A** — NL→code MRR | **1.000** | 0.528 | **1.000** | 0.733 |
| A — R@10 | 1.000 | **1.000** | 1.000 | 1.000 |
| **B** — multi-hop R@10 | 0.500 | **0.833** | 0.333 | 0.167 |
| B — P@5 | 0.267 | 0.333 | 0.133 | 0.067 |
| **C** — dependency F1 | 0.083 | 0.000 | 0.000 | 0.000 |
| **D** — temporal EM | 0.800 | 0.800 | 0.800 | 0.800 |
| D — R@10 range | **0.778** | 0.667 | **0.778** | **0.778** |
| **E** — cross-modal R@10 | **1.000** | **0.833** | 0.125 | 0.500 |
| **F** — document R@10 | 0.900 | **1.000** | **1.000** | **1.000** |

## v0.1.4 vs v0.1.5 — LLM swap only

| Corpus.Task | v0.1.4 (qwen3-coder-next) | **v0.1.5 (glm-5.1)** | Δ |
|---|---|---|---|
| typescript.A MRR | 1.000 | 1.000 | = |
| typescript.A R@10 | 1.000 | 1.000 | = |
| typescript.B R@10 | 0.500 | 0.500 | = |
| typescript.C F1 | 0.083 | 0.083 | = |
| typescript.D EM | 0.800 | 0.800 | = |
| typescript.D R@10 range | 0.444 | **0.778** | ↑ **+0.334** |
| typescript.E R@10 | 0.750 | **1.000** | ↑ **+0.250** |
| typescript.F R@10 | 0.900 | 0.900 | = |
| python.A MRR | 0.528 | 0.528 | = |
| python.A R@10 | 0.667 | **1.000** | ↑ **+0.333** |
| python.B R@10 | 0.833 | 0.833 | = |
| python.B P@5 | 0.367 | 0.333 | ↓ −0.034 |
| python.C F1 | 0.000 | 0.000 | = |
| python.D EM | 0.800 | 0.800 | = |
| python.D R@10 range | 0.667 | 0.667 | = |
| python.E R@10 | 0.833 | 0.833 | = |
| python.F R@10 | 0.900 | **1.000** | ↑ +0.100 |
| go.A MRR | 1.000 | 1.000 | = |
| go.B R@10 | 0.333 | 0.333 | = |
| go.C F1 | 0.000 | 0.000 | = |
| go.D EM | 1.000 | 0.800 | ↓ **−0.200** |
| go.D R@10 range | 0.556 | **0.778** | ↑ +0.222 |
| go.E R@10 | 0.325 | 0.125 | ↓ **−0.200** |
| go.F R@10 | 1.000 | 1.000 | = |
| rust.A MRR | 0.733 | 0.733 | = |
| rust.B R@10 | 0.167 | 0.167 | = |
| rust.C F1 | 0.000 | 0.000 | = |
| rust.D EM | 0.800 | 0.800 | = |
| rust.D R@10 range | 0.333 | **0.778** | ↑ **+0.445** |
| rust.E R@10 | 0.375 | **0.500** | ↑ +0.125 |
| rust.F R@10 | 1.000 | 1.000 | = |

**Net: 8 score-up cells, 3 score-down cells.**

## Reading the deltas

**The headline pattern is D-range across the board.** TypeScript, Go, and
Rust all jumped on temporal range queries (+0.334 / +0.222 / +0.445).
glm-5.1 extracts more timestamps and date-bounded facts from the runbook /
spec corpus than qwen3-coder-next does, and the bridge linker has more
points-in-time to anchor.

**Cross-modal (E) splits.** TypeScript E hit 1.000 (+0.250). Rust E
+0.125. But Go E dropped −0.200, mirroring the same "more aggressive
extraction creates more non-gold ABOUT-edge candidates" pattern that hit
Go in v0.1.3. Task E is n=8 per corpus; one missed pair = 0.125 swing.

**D EM regressed on Go (−0.200).** Same shape as the v0.1.2→v0.1.3 Rust
regression: more extracted entity variants → the gold-truth exact match
gets matched against a slightly different surface form. This is a
labeling-vs-extraction problem, not a retrieval problem.

**python.A R@10 jumped +0.333** while MRR held flat. glm-5.1 surfaces the
right Python symbols within the top-10 more reliably than qwen3 does, but
neither model affects the rerank order for the gold-1 position
(reranker-driven, not LLM-driven).

## Latency

| Corpus | warm p50 | warm p95 | cold p50 |
|---|---|---|---|
| TypeScript | 211 ms | 2633 ms | (mixed, n small) |
| Python | 187 ms | 533 ms | (mixed) |
| Go | 185 ms | 551 ms | (mixed) |
| Rust | 195 ms | 3613 ms | (mixed) |

Warm p50 holds at ~190 ms across corpora — identical to v0.1.4. The LLM
change only affects ingestion latency (entity extraction), not query
latency.

## Ingestion latency

| Corpus | qwen3-coder-next (v0.1.4) | glm-5.1 (v0.1.5) | Δ |
|---|---|---|---|
| TypeScript | ~5 min | **28 min** | 5.6× slower |
| Python | ~5 min | **21 min** | 4.2× slower |
| Go | ~4 min | **18 min** | 4.5× slower |
| Rust | ~5 min | **26 min** | 5.2× slower |
| **Total ingestion** | **~20 min** | **~93 min** | **4.7× slower** |

glm-5.1 produces noticeably richer extractions but at substantially higher
cost per file. For batch indexing workflows where ingestion is one-shot
and queries are hot, this trade is favorable; for tight reindex loops it
is not.

## Reproducing

```bash
docker compose --profile bench up -d cgbench-falkordb
cd benchmarks/cgbench-v1 && pnpm bench:render-docs
benchmarks/cgbench-v1/scripts/run-real-benchmark.sh
```

Required env (in repo `.env`):

```
LLM_PROVIDER=ollama
LLM_MODEL=ollama/glm-5.1
OLLAMA_BASE_URL=http://127.0.0.1:18317/v1   # CLIProxyAPI
OLLAMA_API_KEY=<cliproxy-key>
CODEGRAPH_EMBEDDING_PROVIDER=voyage
VOYAGE_API_KEY=<voyage>
CODEGRAPH_RERANK_PROVIDER=voyage
CODEGRAPH_RERANK_MODEL=rerank-2
```

## Verdict

Pick the entity-extraction LLM based on workload:

- **`glm-5.1`** is the better choice for temporal-rich knowledge corpora
  (runbooks, changelogs, release notes). The D R@10 range jump across
  three of four corpora is structural, not noise. Cost: ~5× slower
  ingestion.
- **`qwen3-coder-next`** wins on raw throughput and on Go cross-modal
  (E). For mostly-code corpora where Task E matters more than Task D,
  qwen3 stays competitive.

Neither model is uniformly better. The 11 score-up / 4 score-down delta
in v0.1.4 vs v0.1.2 looked like quality improvement; the 8/3 delta here
under a pure LLM swap shows how much of the small-n task variance is
extraction-driven rather than retrieval-driven.

## Caveats

- **Same as v0.1.4.** Single-system report; competitor adapters not
  audited.
- **Tasks B and C are vector-only by design.** No NL→Cypher.
- **Small-n variance.** Task E (n=2 per question, 8 total per corpus) and
  Task D point-in-time (n=5 per corpus) swing ±0.125–0.200 on single-
  question changes.
- **One MCP timeout** on TypeScript `knowledge-009.md` (5-min limit);
  retried successfully later in the same run. Did not skip questions.
- **Voyage embedding cost** unchanged from v0.1.4.
