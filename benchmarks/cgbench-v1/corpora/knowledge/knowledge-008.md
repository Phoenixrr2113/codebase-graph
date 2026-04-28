---
id: knowledge-008
title: "Sprint 9 retro: Zod validation performance and union overhead"
author: eve@example.com
valid_at: 2026-03-05T13:00:00Z
references:
  - types.ts#ZodUnion
  - types.ts#ZodOptional
  - types.ts#ZodObject
category: meeting-notes
---

## Attendees
Alice, Bob, Eve

## Discussion

Eve flagged that `ZodUnion` schemas on the webhook event endpoint are adding ~3ms per request in p99. The union has 14 members (one per event type). Zod evaluates each branch in order until one succeeds, so wide unions are O(n) on failure paths.

Bob suggested replacing the `ZodUnion` with a discriminated union using `z.discriminatedUnion("type", [...])` — this is O(1) lookup via the discriminant key. Eve confirmed this only works if every member has a literal `type` field, which our schema does.

Alice noted that `ZodOptional` wrapping on deeply nested fields also generates extra closure allocations. For hot paths, consider pre-compiling schemas to plain JS validators — but this is premature optimization unless profiling confirms it.

## Decisions

- Replace `ZodUnion` with `discriminatedUnion` on the webhook endpoint. Eve owns this.
- No action on `ZodOptional` overhead until we have production profiling data.
- Add schema compilation benchmark to the perf test suite.

## Action Items
- Eve: migrate webhook schema to discriminated union by Mar 12
- Bob: add schema parse micro-benchmark to CI perf suite
