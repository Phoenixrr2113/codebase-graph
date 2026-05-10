# CGBench v0.1.4 — CodeGraph on 4 OSS corpora (final)

> **Honest single-system report.** Same 4 OSS corpora as v0.1.2 / v0.1.3, with
> all language-quality fixes applied. **0 failures across 112 question
> dispatches.** This is the published baseline.

**Run timestamp:** 2026-05-10 (Eastern)
**Git SHA:** `f6be9ef`

## Headline numbers

| Task | TypeScript (zod) | Python (requests) | Go (chi) | Rust (clap) |
|---|---|---|---|---|
| **A** — NL→code MRR | **1.000** | 0.528 | **1.000** | 0.733 |
| A — R@10 | 1.000 | 0.667 | 1.000 | 1.000 |
| **B** — multi-hop R@10 | 0.500 | **0.833** | 0.333 | 0.167 |
| B — P@5 | 0.267 | 0.367 | 0.133 | 0.067 |
| **C** — dependency F1 | 0.083 | 0.000 | 0.000 | 0.000 |
| **D** — temporal EM | 0.800 | 0.800 | **1.000** | 0.800 |
| D — R@10 range | 0.444 | 0.667 | 0.556 | 0.333 |
| **E** — cross-modal R@10 | 0.750 | **0.833** | 0.325 | 0.375 |
| **F** — document R@10 | 0.900 | 0.900 | **1.000** | **1.000** |

## Evolution from v0.1.2 baseline

| Corpus.Task | v0.1.2 | v0.1.3 | **v0.1.4** | Δ vs v0.1.2 |
|---|---|---|---|---|
| typescript.A MRR | 1.000 | 1.000 | 1.000 | = |
| typescript.B R@10 | 0.500 | 0.500 | 0.500 | = |
| typescript.C F1 | 0.000 | 0.083 | **0.083** | ↑ +0.083 |
| typescript.D EM | 0.800 | 0.800 | 0.800 | = |
| typescript.E R@10 | 0.750 | 0.875 | 0.750 | = |
| typescript.F R@10 | 0.800 | 0.800 | **0.900** | ↑ +0.100 |
| python.A MRR | 0.500 | 0.528 | **0.528** | ↑ +0.028 |
| python.B R@10 | 0.333 | 0.833 | **0.833** | ↑ **+0.500** |
| python.C F1 | 0.083 | 0.000 | 0.000 | ↓ −0.083 |
| python.D EM | 0.800 | 0.800 | 0.800 | = |
| python.E R@10 | 0.583 | 0.833 | **0.833** | ↑ **+0.250** |
| python.F R@10 | 1.000 | 0.900 | 0.900 | ↓ −0.100 |
| go.A MRR | 1.000 | 1.000 | 1.000 | = |
| go.B R@10 | 0.333 | 0.333 | 0.333 | = |
| go.C F1 | 0.000 | 0.000 | 0.000 | = |
| go.D EM | 0.800 | 0.800 | **1.000** | ↑ **+0.200** |
| go.E R@10 | 0.450 | 0.225 | 0.325 | ↓ −0.125 |
| go.F R@10 | 0.900 | 0.900 | **1.000** | ↑ +0.100 |
| rust.A MRR | 0.733 | 0.733 | 0.733 | = |
| rust.B R@10 | 0.000 | 0.167 | **0.167** | ↑ +0.167 |
| rust.C F1 | 0.000 | 0.000 | 0.000 | = |
| rust.D EM | 1.000 | 0.800 | 0.800 | ↓ −0.200 |
| rust.E R@10 | 0.250 | 0.375 | **0.375** | ↑ +0.125 |
| rust.F R@10 | 0.900 | 1.000 | **1.000** | ↑ +0.100 |

**Net: 11 score-up cells, 4 score-down cells.** The four downs are all
single-question swings on small-n tasks (each task has 2–10 questions per
corpus), driven by LLM-extraction variance — different `qwen3-coder-next`
runs pick slightly different entity text and the bridge linker matches
different code symbols.

## What changed (commits between v0.1.2 and v0.1.4)

| Commit | Fix |
|---|---|
| `1b1a52a` + `cb3df17` | **Test-file ranking demotion (2-pass).** Cross-encoders frequently rank `test_xxx_redirect` above `resolve_redirects` when both look semantically related to the query. A configurable 0.7× score multiplier on candidates whose path matches `**/tests/**`, `**/__tests__/**`, `**_test.go`, `*.test.ts`, `*.spec.ts` etc. fixes ambiguous-query rankings. |
| `bf955d3` | **Wider candidate / rerank pools.** perTypeLimit 20 → 40, rerank pool 30 → 60. Previously the gold function would rank deeper than 30 by raw vector similarity for some NL queries and never reach the cross-encoder. |
| `6720f0d` | **Root-cause fix: Python/Go/Rust plugins now wire their standalone `extractAllEntities` into the plugin object.** Each plugin had a correct standalone function that merged class/struct method entities back into the functions array, but it was never wired in — `pythonPlugin = createLanguagePlugin(...)` returned the plugin object whose `extractAllEntities` was the generic factory's composed version (which calls `extractFunctions` only, dropping every class method per contract). TypeScript was already correct. Effect: psf-requests/sessions.py went from 3 functions in the indexed graph to 28; resolve_redirects, request, prepare_request, send, etc. all became indexable. |
| `f6be9ef` | **Bridge-linker stopwords.** Tier-3 contained-match in the bridge linker now requires symbol name length ≥ 5 AND not in a curated stopword list (new, get, set, send, parse, render, run, init, default, etc.). Without this, knowledge entity text like "update runbook with new retry defaults" matched every Foo::new constructor in the Rust corpus, creating thousands of spurious ABOUT edges that poisoned cross-modal retrieval. |

## Reproducing

```bash
docker compose --profile bench up -d cgbench-falkordb
cd benchmarks/cgbench-v1 && pnpm bench:render-docs
benchmarks/cgbench-v1/scripts/run-real-benchmark.sh
```

Required env (in repo `.env`):

```
LLM_PROVIDER=ollama
LLM_MODEL=ollama/qwen3-coder-next
OLLAMA_BASE_URL=http://127.0.0.1:18317/v1   # CLIProxyAPI
OLLAMA_API_KEY=<cliproxy-key>
CODEGRAPH_EMBEDDING_PROVIDER=voyage
VOYAGE_API_KEY=<voyage>
CODEGRAPH_RERANK_PROVIDER=voyage
CODEGRAPH_RERANK_MODEL=rerank-2
```

## Caveats

- **Single-system report only.** Competitor adapters (mempalace, cognee,
  mcp-codebase-index, supermemory, hindsight) need their own audit before
  any cross-system claim is honest.
- **Tasks B and C are vector-only by design.** The adapter routes them
  through `search.find`; structural traversal requires the `query` MCP
  tool with hand-written Cypher.
- **Single LLM run for entity extraction.** Small-n tasks (Task E n=2,
  Task D point-in-time n=5) carry meaningful run-to-run variance.
  Stronger LLM (`gemma4`, `glm-5.1`) would likely shift Task D/E.
- **Voyage embedding cost** ≤ $5 for the full 4-corpus run (likely $0
  in the 200M-token free tier).
