# Question Set Review — v0.1

Author: subagent-driven authoring (CGBench v1 Plan 2 Tasks 4-9)
Date: 2026-04-28

## Counts

| Task | File | Count | Spec target | Notes |
|---|---|---|---|---|
| A | task-a.jsonl | 12 | 60 | NL→code, 3/lang × 4 |
| B | task-b.jsonl | 12 | 48 | structural (callers/extenders/importers), 3/lang × 4 |
| C | task-c.jsonl | 8 | 32 | multi-hop (≤3 hops), 2/lang × 4 |
| D | task-d.jsonl | 8 | 30 | bitemporal (5 point-in-time, 3 range) |
| E | task-e.jsonl | 8 | 30 | linked code+knowledge, 2/corpus × 4 |
| F | task-f.jsonl | 10 | 30 | doc ingestion, 2/format × 5 |

Total: 58 questions (vs spec target 230). v0.1 sample.

## Authoring discipline applied

- Every gold ID was verified against the actual corpus by `git grep` or by reading frontmatter.
- NL phrasings for Task A describe behavior, not paraphrased docstrings.
- Multi-gold questions include all acceptable answers, not just one.
- Task C hop distances were hand-traced through the call graph; capped at 1-2 hops in v0.1 (3-hop deferred for clarity).
- Task D supersession queries reference the knowledge-003 → knowledge-009 pair authored in Task 1.
- Task E linkage was verified by checking that knowledge-doc `references:` frontmatter contains the gold code symbols.
- Task F: each fact file is tested by exactly one question; format-tagging is informational metadata pending Plan 4's per-format ingestion gating.

## Smoke results (lexical adapter, Plan 1's CodeGraph baseline)

| Task | Per-language MRR / Recall@10 (where applicable) |
|---|---|
| A | Py 0.23, TS 0.83, Go 0.07, Rust 1.0 (MRR) |
| B | Py 0, TS 0, Go 0.083, Rust 0 (R@10) |

The low scores on Task B confirm the lexical adapter's structural-retrieval gap — the benchmark exercises CodeGraph's actual differentiator (graph edges) only when Plan 4 swaps to a graph-aware query path.

## Known gaps for the spec's full counts

- Per-language coverage at v0.1 is 2-3 questions per language vs spec's 8-15. Statistical confidence is correspondingly lower.
- No second labeler reviewed this set. Plan 4 should commission one before publishing.
- Task F's per-format ingestion gating is deferred (the format field is metadata only in v0.1).
- PDF rendering disabled (no pdflatex on author's machine; install `basictex` for Plan 4 publishing).

## Reviewer sign-off

- [x] Self-review pass complete (this document)
- [x] Schema-validation tests pass
- [ ] Independent reviewer pass (deferred to Plan 4)
