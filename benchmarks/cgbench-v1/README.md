# CGBench v1

CodeGraph public benchmark — measures retrieval quality, latency, ingestion speed, and resource footprint across multiple code-knowledge systems on a uniform task battery.

**Status:** Plan 1 of 4 (foundations + CodeGraph adapter). Plans 2-4 add questions, competitor adapters, and the public publish workflow.

## Prereqs

- Node 20 or later
- `redis-server` (for FalkorDBLite): `brew install redis` on macOS
- `pandoc` (for document rendering, used by Plan 2): `brew install pandoc` on macOS
- `git` (for cloning OSS code corpora)

## Setup

```bash
pnpm install
pnpm --filter @codegraph/cgbench-v1 bench:clone-corpora
```

The first command installs workspace deps. The second clones the 4 pinned OSS code corpora into `corpora/code/` (`psf-requests`, `colinhacks-zod`, `go-chi-chi`, `clap-rs-clap`). The script is idempotent — re-running it skips corpora already at the pinned SHA.

## Run a single-system benchmark

```bash
# Run CodeGraph against the tiny-ts fixture (sanity check)
cd benchmarks/cgbench-v1
npx tsx src/cli.ts run \
  --system codegraph \
  --corpus fixtures/code/tiny-ts \
  --questions fixtures/questions/smoke.jsonl \
  --results-dir /tmp/cgbench-results
```

Output: `/tmp/cgbench-results/<iso-timestamp>/per-system/codegraph.json`.

Expected smoke result on the fixture: 3 questions, Task A MRR ≈ 0.83, Recall@10 = 1.0.

The JSON contains:
- `system`, `questionCount`
- `tasks.<A-F>` — per-task `count`, `mrr`, `recallAt10`
- `latency` — cold/warm/all buckets with count, p50/p95/p99, mean, min, max
- `ingestion` — `durationMs`, `totalDocs`, `totalTokens`, `diskBytesAfter`, `tokensPerSecond`

**macOS note:** `--results-dir` paths under `/Users/...` may exceed the FalkorDBLite Unix-socket limit (104 bytes). Prefer a short path like `/tmp/cgbench-results`.

## What's in this plan

| Phase | Tasks | Status |
|---|---|---|
| Workspace scaffolding | 1-3 | Plan 1 |
| Corpus assembly | 4-6 | Plan 1 |
| Scoring engine | 7-12 | Plan 1 |
| CodeGraph adapter | 13-15 | Plan 1 |
| Runner + CLI | 16-17 | Plan 1 |
| Question authoring (~210-300 hand-labeled) | — | Plan 2 |
| Competitor adapters (×7) | — | Plan 3 |
| Public results + landing-page link | — | Plan 4 |

## Architecture

- `src/adapter.ts` — `BenchmarkAdapter` interface (every system implements this).
- `src/types.ts` — zod schemas for corpora, questions, ranked results, manifest.
- `src/score/` — pure functions: MRR, Recall@k, Precision@k, F1, EM.
- `src/metrics/` — latency aggregation (p50/p95/p99 cold/warm), RSS sampling, disk measurement, ingestion throughput.
- `src/adapters/codegraph.ts` — native adapter wrapping `@codegraph/core`'s indexer + production vector+reranker search (`enrichedSearchV2`). Falls back to lexical Cypher when `embeddingProvider: 'none'`.
- `src/runner.ts` — ingest → query loop → score → return `RunResult`.
- `src/cli.ts` — `bench run --system <name>` writes `RunResult` to `results/<timestamp>/per-system/<system>.json`.
- `fixtures/` — tiny in-repo corpus + smoke questions for integration tests. Real corpora live in `corpora/`.

## Embedding providers

The CodeGraph adapter supports three embedding providers for vector search:

| Provider | Env | Notes |
|---|---|---|
| `local` | (none required) | `nomic-ai/nomic-embed-text-v1.5` via `@huggingface/transformers`. Downloads ~140MB model on first run. ~10ms/embedding on CPU. Default when no API key is set. |
| `voyage` | `VOYAGE_API_KEY` | `voyage-code-3` (1024-dim, code-optimized). Auto-selected when key is present. |
| `openrouter` | `OPENROUTER_API_KEY` | `text-embedding-3-small` (1536-dim). Auto-selected when key is present. |
| `none` | (none) | Lexical fallback only (name+filePath Cypher). Use for offline/CI environments. |

Set `CODEGRAPH_EMBEDDING_PROVIDER=<provider>` to override auto-detection.

The reranker (cross-encoder) is auto-detected from `JINA_API_KEY` / `VOYAGE_API_KEY`. Without a key, the adapter uses raw vector similarity scores. Set `CODEGRAPH_RERANK_PROVIDER=none` to disable explicitly.

### Lexical fallback

When `embeddingProvider: 'none'` (or `CODEGRAPH_EMBEDDING_PROVIDER=none`), the adapter falls back to direct Cypher name-match with 4-char-prefix stem expansion — no API key or model required. This mode is suitable for CI and offline testing but produces lower MRR (~0.21 on the smoke fixture).

## Plan 1 limitations

- **`tokensPerSecond` is approximated** as `diskBytesAfter / 4 / durationMs`. Replace with real token counts when `indexProject` exposes them.
- **Path-length constraint** on FalkorDBLite Unix socket: keep `--results-dir` short on macOS.

## Spec

`docs/superpowers/specs/2026-04-27-codegraph-benchmark-design.md` (gitignored, local-only).
`docs/superpowers/plans/2026-04-27-cgbench-v1-plan1-foundations.md` — this plan.
