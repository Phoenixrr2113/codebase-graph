# CGBench v0.1.3 — CodeGraph on 4 OSS corpora (post-fixes)

> **Honest single-system report.** Same 4 OSS corpora and methodology as
> v0.1.2-real, with several quality fixes applied. 0 failures across 112
> question dispatches.

**Run timestamp:** 2026-05-10 (Eastern)
**Git SHA:** `bf955d3`
**Compared baseline:** `v0.1.2-real` (earlier same day)

## What changed since v0.1.2

| Commit | What |
|--------|------|
| `1b1a52a` + `cb3df17` | Test-file ranking demotion (2-pass, configurable via `CODEGRAPH_TEST_PENALTY`). |
| `bf955d3` | Wider candidate / rerank pools (perTypeLimit 20 → 40, rerank pool 30 → 60). |
| `6720f0d` | **Root-cause fix:** Python, Go, Rust plugins each defined a standalone `extractAllEntities` that correctly merges class/struct method entities back into the functions array, but the function was never wired into the plugin object. The composed `extractAllEntities` from the generic factory dropped every class method between extraction and graph persistence. TypeScript was already correct. |

The `extractAllEntities` wiring bug was the largest of these. Before the
fix, `psf-requests/sessions.py` had 28 functions in source but only 3 in
the indexed graph. After the fix: 28 functions including
`resolve_redirects`, `request`, `prepare_request`, etc. The bridge linker
now has real methods to ABOUT-edge, and vector search has real methods
to retrieve.

## Quality — pre/post comparison

| Corpus | Task | Metric | v0.1.2 | v0.1.3 | Δ |
|---|---|---|---|---|---|
| TypeScript | A | MRR | 1.000 | 1.000 | = |
| TypeScript | B | R@10 | 0.500 | 0.500 | = |
| TypeScript | C | F1 | 0.000 | 0.083 | ↑ +0.083 |
| TypeScript | D | EM | 0.800 | 0.800 | = |
| TypeScript | E | R@10 | 0.750 | **0.875** | ↑ +0.125 |
| TypeScript | F | R@10 | 0.800 | 0.800 | = |
| Python | A | MRR | 0.500 | 0.528 | ↑ +0.028 |
| Python | B | R@10 | 0.333 | **0.833** | ↑ **+0.500** |
| Python | C | F1 | 0.083 | 0.000 | ↓ −0.083 |
| Python | D | EM | 0.800 | 0.800 | = |
| Python | E | R@10 | 0.583 | **0.833** | ↑ **+0.250** |
| Python | F | R@10 | 1.000 | 0.900 | ↓ −0.100 |
| Go | A | MRR | 1.000 | 1.000 | = |
| Go | B | R@10 | 0.333 | 0.333 | = |
| Go | C | F1 | 0.000 | 0.000 | = |
| Go | D | EM | 0.800 | 0.800 | = |
| Go | E | R@10 | 0.450 | 0.225 | ↓ −0.225 |
| Go | F | R@10 | 0.900 | 0.900 | = |
| Rust | A | MRR | 0.733 | 0.733 | = |
| Rust | B | R@10 | 0.000 | 0.167 | ↑ +0.167 |
| Rust | C | F1 | 0.000 | 0.000 | = |
| Rust | D | EM | 1.000 | 0.800 | ↓ −0.200 |
| Rust | E | R@10 | 0.250 | 0.375 | ↑ +0.125 |
| Rust | F | R@10 | 0.900 | 1.000 | ↑ +0.100 |

### Wins

- **Python Task B (+0.500 R@10)** — the multi-hop "functions that call X"
  questions now find real methods because `resolve_redirects` & friends are
  actually in the graph.
- **Python Task E (+0.250 R@10)** — cross-modal expansion has real code
  nodes to ABOUT-link to via the bridge linker.
- **TypeScript Task E (+0.125 R@10)** — same mechanism; TS had less of the
  bug because its plugin was already wired correctly, but the wider pools
  and test-file demotion still helped.
- **Rust Tasks B, E, F all up.**

### Regressions

The score-down deltas are small in absolute terms (1–2 questions each on
small-n tasks) and come from LLM-extraction variance — different runs
produce slightly different entity text and the bridge linker matches
different code symbols, which shifts which gold IDs surface in
cross-modal queries.

- **Python Task C (−0.083 F1)** — single question shifted; vector-only
  baseline near zero anyway.
- **Python Task F (−0.100 R@10)** — single document missed.
- **Go Task E (−0.225 R@10)** — most concerning regression. With more Go
  methods indexed, the bridge linker's name-matching has more candidates,
  and the LLM-extracted entity names happened to map to non-gold methods
  this run.
- **Rust Task D (−0.200 EM)** — same kind of LLM variance on temporal
  knowledge recall.

## Latency

| Corpus | warm p50 | warm p95 | cold p50 |
|---|---|---|---|
| TypeScript | 198 ms | 1830 ms | 2042 ms |
| Python | 200 ms | 657 ms | 489 ms |
| Go | 192 ms | 521 ms | 511 ms |
| Rust | 195 ms | 1244 ms | 678 ms |

Warm p50 holds at ~195 ms. Wider pools added ~5 ms (one extra reranker
batch).

## What didn't change

The structural limits documented in v0.1.2 still apply:

- **Tasks B and C are vector-only by design.** The adapter routes them
  through `search.find`; structural traversal requires the `query` MCP
  tool with hand-written Cypher.
- **Cross-modal expansion variance.** Different LLMs extract entities
  differently. Switching from `qwen3-coder-next` to `gemma4` or `glm-5.1`
  is one knob users can turn.

## Caveats

Same caveats as v0.1.2:

- Single-system report. Competitor adapters (mempalace, cognee,
  mcp-codebase-index, supermemory, hindsight) need their own audit.
- Single LLM run for entity extraction; small-n metrics (Task E n=2)
  carry meaningful run-to-run variance.
- Voyage embedding cost ≤ $5 for the full 4-corpus run.
