---
id: knowledge-009
title: "Decision: switch chi router to group-based subrouting (supersedes ADR-007)"
author: carol@example.com
valid_at: 2026-03-15T11:00:00Z
references:
  - mux.go#Group
  - mux.go#Route
  - mux.go#Use
  - mux.go#ServeHTTP
category: decision
---

## Context

ADR-007 (knowledge-003) selected `chi.NewRouter()` with `Mux.Mount` for domain subrouting. After the trailing-slash bug in the ticket (knowledge-007) and a separate issue with middleware scoping across mounted sub-routers, the team revisited the routing strategy.

## Decision

Replace all `Mux.Mount` calls with inline `Mux.Group` or `Mux.Route`. `Group` creates a scoped router that shares the parent middleware stack, which is what we actually want for auth middleware. `Route` is used for nested path prefixes with their own handler.

`Mux.Use` is still the registration point for global middleware. Nothing changes there.

## Why This Supersedes knowledge-003

The original decision assumed `Mount` would be sufficient. The trailing-slash regression (knowledge-007) and the middleware-scoping issue proved it unsuitable for our routing shape. `Group`/`Route` integrate better with chi's internal trie and avoid the sub-router isolation that caused both bugs.

## Outcome

All service routes migrated to `Group`/`Route` in sprint 11. `Mux.ServeHTTP` behavior is unchanged externally — only the internal registration structure changed.
