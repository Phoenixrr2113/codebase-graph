---
id: knowledge-007
title: "Ticket: chi Mount strips trailing slashes on nested routes"
author: carol@example.com
valid_at: 2026-02-25T16:30:00Z
references:
  - mux.go#NewRouter
  - mux.go#Route
  - mux.go#Mount
category: ticket
---

## Summary

Calling `Mux.Mount("/api", subRouter)` and then requesting `/api/users/` (with trailing slash) returns 404. The same path without the trailing slash works correctly. This is breaking a set of integration tests that always append `/`.

## Reproduction

```go
r := chi.NewRouter()
sub := chi.NewRouter()
sub.Get("/users", listUsers)
r.Mount("/api", sub)
// GET /api/users  → 200
// GET /api/users/ → 404
```

## Root Cause

`Mount` strips the mount prefix before passing to the sub-router, but the trailing-slash redirect in chi's trie fires only when the route is registered with `Route`. When using `Mount`, the sub-router never sees the redirect logic from the parent.

## Proposed Fix

Register the sub-routes using `Mux.Route("/api", ...)` instead of `Mux.Mount`. The `Route` method creates an inline sub-router that participates in the parent's redirect rules.

## Workaround

Add `r.Get("/api/users/", redirectNoTrailingSlash)` manually for each affected route. Ugly but unblocks QA.

## Owner
Carol — blocking release candidate, escalate if not fixed by Mar 1
