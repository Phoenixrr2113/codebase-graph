---
id: knowledge-003
title: "Decision: chi router as the HTTP multiplexer (initial)"
author: carol@example.com
valid_at: 2026-01-08T09:30:00Z
invalid_at: 2026-03-15T11:00:00Z
references:
  - chi.go#NewRouter
  - mux.go#ServeHTTP
  - mux.go#Use
category: decision
---

## Context

We need an HTTP router for the Go service gateway. Evaluated `net/http` (stdlib mux), chi, gorilla/mux, and httprouter.

## Decision

Use `chi.NewRouter()`. The `Mux.ServeHTTP` implementation is stdlib-compatible, so we can pass the router directly to `http.ListenAndServe`. Middleware is registered via `Mux.Use`, which chains handlers cleanly without global state.

## Alternatives Considered

- **stdlib mux**: no middleware support, no route params beyond basic patterns.
- **gorilla/mux**: heavier, slower routing, maintenance uncertain.
- **httprouter**: fast but no middleware interface; middleware requires third-party wrapping.

## Outcome

chi v5 selected. `NewRouter()` returns a `*Mux` that satisfies `http.Handler`. All middleware for auth, logging, and request-id injection will be registered via `Use` before any routes.

## Note

This decision is provisional — if we need pattern-based subrouting across domain boundaries, we will revisit with `Mux.Mount` or a separate approach. Tracked in ADR-007.
