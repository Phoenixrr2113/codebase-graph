---
id: knowledge-005
title: "Sprint 6 planning: session lifecycle and redirect handling"
author: alice@example.com
valid_at: 2026-02-03T11:00:00Z
references:
  - sessions.py#Session
  - sessions.py#resolve_redirects
  - sessions.py#rebuild_auth
category: meeting-notes
---

## Attendees
Alice, Bob, Eve

## Goals
Define how the SDK manages `Session` lifecycle and handles redirect chains.

## Discussion

`Session` is not thread-safe; the team agreed it should be created per-request in high-concurrency paths, not shared. Eve noted that `resolve_redirects` is a generator that mutates the response chain in place — callers must not hold references to intermediate responses across redirect hops.

The most contentious item was re-authentication on redirects. `rebuild_auth` strips `Authorization` headers when crossing scheme or host boundaries (the stdlib behavior). We want to preserve credentials when redirecting within the same domain. Alice proposed overriding `rebuild_auth` in a `Session` subclass to relax the host-boundary check.

Bob flagged that this could be a security regression if the check is loosened too far — need to confirm the exact condition.

## Decisions
- `Session` instances are NOT pooled; create and close per request.
- `rebuild_auth` override will be scoped to same-host, same-scheme redirects only.
- Eve will audit all call sites of `resolve_redirects` before sprint 7.

## Action Items
- Alice: draft `rebuild_auth` override by Feb 10
- Eve: redirect call-site audit by Feb 7
