# CGBench Knowledge Corpus

Synthetic timestamped knowledge documents for CGBench v1 Tasks D (bitemporal recall) and E (linked code + knowledge).

## Purpose

These documents simulate real engineering artifacts — meeting notes, specs, tickets, and decisions — that reference actual symbols in the four pinned OSS corpora. The temporal metadata (`valid_at`, `invalid_at`) enables benchmark questions about what was known at a given point in time, how facts changed, and which code symbols were mentioned in which documents.

## Document Structure

Every document is a markdown file with YAML frontmatter followed by a body.

### Frontmatter fields

| Field | Required | Description |
|-------|----------|-------------|
| `id` | yes | Matches filename: `knowledge-NNN` |
| `title` | yes | Short human-readable title |
| `author` | yes | Author email (fictional, consistent across docs) |
| `valid_at` | yes | ISO 8601 — when this fact became true |
| `invalid_at` | no | ISO 8601 — when a later doc superseded this one |
| `references` | yes | One or more `<basename>#<symbol>` identifiers |
| `category` | yes | `meeting-notes`, `spec`, `ticket`, or `decision` |

### `references` format

Each entry is `<filename>#<symbol>` where `<filename>` is the basename of a source file in one of the four corpora and `<symbol>` is a function, method, class, or struct name defined in that file. All references have been verified via `git grep` at the pinned commits.

## Supersession Pair

**knowledge-003** and **knowledge-009** form the supersession pair on the topic of chi router strategy:

- `knowledge-003` (`valid_at: 2026-01-08`, `invalid_at: 2026-03-15`) — initial decision to use `Mux.Mount` for domain subrouting.
- `knowledge-009` (`valid_at: 2026-03-15`) — superseding decision to switch to `Mux.Group`/`Mux.Route` after a series of bugs with the Mount approach.

The `invalid_at` on `knowledge-003` matches the `valid_at` on `knowledge-009`, making the handoff precise.

## Categories

| Category | Doc IDs |
|----------|---------|
| `meeting-notes` | 001, 005, 008, 010 |
| `spec` | 002, 006 |
| `ticket` | 004, 007 |
| `decision` | 003, 009 |

## Symbol Reference Summary

| Corpus | Language | Files Referenced | Symbols Referenced |
|--------|----------|-----------------|-------------------|
| psf-requests | Python | `sessions.py`, `adapters.py`, `models.py` | `prepare_request`, `Session`, `resolve_redirects`, `rebuild_auth`, `HTTPAdapter`, `send` |
| colinhacks-zod | TypeScript | `types.ts` | `ZodObject`, `ZodString`, `ZodError`, `ZodUnion`, `ZodOptional` |
| go-chi-chi | Go | `mux.go`, `chi.go`, `context.go` | `NewRouter`, `ServeHTTP`, `Use`, `Route`, `Mount`, `Group` |
| clap-rs-clap | Rust | `command.rs`, `arg.rs`, `arg_matches.rs` | `Command`, `Arg`, `ArgMatches`, `get_matches` |

## Authors

| Author | Docs |
|--------|------|
| `alice@example.com` | 001, 005 |
| `bob@example.com` | 002, 006 |
| `carol@example.com` | 003, 007, 009 |
| `dave@example.com` | 004, 010 |
| `eve@example.com` | 008 |
