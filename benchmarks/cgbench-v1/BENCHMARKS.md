# CGBench v1 — Results

> **v0.1.0 — smoke fixture only.** Numbers below are from the 3-file TypeScript smoke fixture
> + 10 knowledge/document docs bundled in the repo. Statistical confidence is low (n=3 questions, Task A only).
> v0.1.2 (next release) will publish real-corpus numbers against the 4 OSS corpora pinned in `corpora/code/manifest.json` and the full Task A–F question set.
>
> **cognee status (2026-08-19):** the batch-run crash is fixed. cognee is still absent from
> the table below, but the reason is now inference cost, not a defect. See
> "Why cognee has no score" below the results. The zod hang is fixed (2026-08-20): see
> "The zod query hang" below.

**Run timestamp:** 2026-04-28T14:43:04.958Z
**Corpus:** smoke fixture (`fixtures/code/tiny-ts`, `corpora/knowledge`, `documents/source`)
**Systems tested:** codegraph, mcp-codebase-index, mempalace
**Runnable but unscored:** cognee (batch crash fixed 2026-08-19; unscored on inference cost, see below)
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

## Why cognee has no score

cognee is the most capable system in this comparison and the most commonly suggested
alternative to CodeGraph, so its absence from the table needs an explicit reason rather
than a footnote.

**The batch crash is fixed (2026-08-19).** Earlier releases excluded cognee because
`bench run-all` aborted natively with `libc++ mutex lock failed`. Root cause: the runner
dispatched queries with a concurrency of 3, and the cognee adapter opens Kuzu and LanceDB
inside a fresh Python subprocess per query. Kuzu does not permit concurrent multi-process
access to one database directory. The fix is a `maxQueryConcurrency` ceiling on the adapter
contract, which cognee sets to 1. cognee is now runnable end to end under `run-all`.

**The remaining blocker is inference cost, measured not guessed.** On the 3-file, 882-byte
`fixtures/code/tiny-ts` fixture, one full ingest plus query took **160 seconds wall clock**
and issued **31 generation calls producing 11,698 tokens** against `qwen3.5:9b` on local
Ollama at roughly 48.5 tokens/sec. That is about 13 generated tokens per source byte,
because `cognify()` runs LLM entity and relationship extraction over every chunk.

Extrapolated linearly against the code bytes this adapter actually ingests:

| Corpus | Ingestable code | Order-of-magnitude cognee ingest |
|--------|-----------------|----------------------------------|
| go-chi-chi | 285 KB | ~1 day |
| psf-requests | 375 KB | ~1 day |
| colinhacks-zod | 2.26 MB | ~1 week |
| clap-rs-clap | 2.55 MB | ~1 week |

These are extrapolations from a single fixture and include fixed startup cost, so treat
them as magnitude rather than precision. Even discounted generously, the full battery is a
multi-day local-inference job. Publishing a cognee column measured on a different corpus
size than every other system would not be a comparison, so cognee stays unscored until we
run it on identical inputs.

**What we can already say without a score.** On the smoke fixture cognee answered
"function that retries failed requests" with `retry.ts` ranked first, which is the correct
answer. It is a competent retrieval system and we make no claim otherwise.

### Fairness caveat on any future cognee number

The adapter drives cognee through `cognee.add()` plus `cognify()` plus
`SearchType.CHUNKS`. That is cognee's **general text pipeline**: chunk, LLM-extract
entities, embed. It is not their code-specific path, which lives in
`cognee-community-tasks-codify` and the community code retriever.

We did not use the code path because it is not usable with a current cognee.
`cognee-community-tasks-codify` v0.1.5 pins `cognee==0.5.6`, while cognee core is at v1.5.0
(released 2026-08-15). Running their AST pipeline would require downgrading cognee by
more than five minor versions.

Any number CGBench eventually publishes for cognee must therefore be labelled
"cognee's general memory pipeline applied to code", not "cognee".

---

## Caveats
- v0.1.0 is smoke-fixture only; n=3 questions, low statistical confidence — results demonstrate methodology, not production ranking.
- codegraph runs with local Hugging Face embeddings (no API keys required); no reranker (CODEGRAPH_RERANK_PROVIDER=none).
- mempalace MRR=0 reflects a fundamental file-vs-function granularity mismatch, not a retrieval failure.
- supermemory (requires SUPERMEMORY_API_KEY), hindsight (requires HINDSIGHT_URL): READY-WITH-KEY but excluded from this run.
- cognee: runnable end to end as of 2026-08-19 (the `libc++ mutex` crash was a runner concurrency bug in CGBench, now fixed). Unscored because a like-for-like run is a multi-day local-inference job. See "Why cognee has no score".
- mastra-memory, augment: DEFERRED stubs — see COMPETITORS.md.
- v0.1.2 will (a) run cognee on identical inputs once the compute budget allows, (b) run against the 4 OSS corpora with the full question set. The zod query hang that blocked (b) is fixed; see "The zod query hang".

---

## The zod query hang

Resolved 2026-08-20. Recorded here because the diagnosis says something about the
corpus, not just about our code.

`enrichedSearchV2` decorates each hit with a `dependencyDepth`: the shortest chain
from an entry point (a file nothing imports) to the symbol, bounded to six hops.
It asked for that with an `OPTIONAL MATCH` over a variable-length pattern. That
form is cheap when a path exists and ruinous when one does not, because proving
absence means enumerating the symbol's entire six-hop neighbourhood.

zod has a symbol built to make that expensive. `_parse` is implemented on every
schema type, so the name resolves to 38 nodes carrying 1406 inbound and 2340
outbound CALLS edges among them, and no entry point reaches any of them within
six hops. Enumerating that ran past 120s. Because FalkorDB serves one query at a
time, the stall was not confined to the field it was computing: every later stage
of the same search queued behind it, which is why the symptom read as "hangs at
first query" rather than "one enrichment is slow".

Rewriting the query as a plain `MATCH`, which simply yields no row for
unreachable symbols, left the answers unchanged and removed the cost of proving
absence. Measured over 400 distinct zod symbols:

| | current form | previous form |
|---|---|---|
| Total time | 0.4s | 240s |
| Symbols exceeding 20s | 0 | 12 |
| Answers agreeing | 388 of 388 the old form could finish | baseline |

The other 8K-entity structural work was never the problem: label scans, vector
retrieval and the remaining enrichment queries all answered in single-digit
milliseconds on the same graph. Regression cover is in
`packages/core/src/__tests__/dependency-depth.integration.test.ts`, which
reproduces the blowup with 16 same-named functions and fails in about 20s
against the old query.

---

## Methodology

- See `benchmarks/cgbench-v1/README.md` for setup
- See `benchmarks/cgbench-v1/COMPETITORS.md` for system status
- See `benchmarks/cgbench-v1/questions/REVIEW.md` for question authoring discipline
- Benchmark framework: custom TypeScript harness (`benchmarks/cgbench-v1/src/`)
- Scoring: MRR (reciprocal rank of first gold hit), Recall@K, Precision@K, F1, EM
- Latency: wall-clock per query including network/subprocess overhead; first N queries marked cold
