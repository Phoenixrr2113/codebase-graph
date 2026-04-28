---
id: knowledge-002
title: "Spec: Zod schema validation layer for user input"
author: bob@example.com
valid_at: 2025-12-18T14:00:00Z
references:
  - types.ts#ZodObject
  - types.ts#ZodString
  - types.ts#ZodError
category: spec
---

## Overview

All user-facing API endpoints must validate incoming JSON bodies using Zod before touching business logic. This document specifies the validation architecture.

## Design

We use `ZodObject` to define per-endpoint schemas. Fields are typed with `ZodString`, `ZodOptional`, and other primitives as appropriate. Schemas are colocated with the route handler, not shared globally, to avoid cross-route coupling.

On validation failure, Zod throws a `ZodError` containing structured issue paths. The error handler extracts `ZodError.issues` and returns a 422 response with a sanitized message array — internal field paths are included but raw values are stripped before serialization.

## Constraints

- No `z.any()` — every field must have an explicit type.
- `ZodString` fields must chain `.max(500)` unless the field is explicitly a long-text field.
- Schemas must be frozen (`.readonly()`) for shared types to prevent mutation at runtime.

## Rationale

This replaces the current ad-hoc `if (!body.name)` checks scattered across handlers. Centralizing validation in Zod schemas makes the contract explicit and testable without running the full server.
