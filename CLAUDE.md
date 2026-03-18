# CodeGraph — AI Assistant Skill Document

CodeGraph indexes codebases into a graph database (FalkorDB) and provides MCP tools for code search, context retrieval, knowledge management, and raw graph queries.

## Quick Start

Check if a codebase is indexed:
```
codebase({ action: "status" })
```

If no projects are configured:
```
codebase({ action: "configure", projectAction: "set", projects: ["/path/to/project"] })
codebase({ action: "reindex", mode: "full" })
```

## Tool Reference

### 1. `search` — Find code

Vector search + cross-encoder reranking. Returns enriched results with complexity, callers, callees.

| Action | Use When | Required Params |
|--------|----------|-----------------|
| `find` | Looking for files, functions, classes, symbols | `query` |
| `context` | Need relationships and structure for a file or symbol | `file` or `symbol` |

**Examples:**
```
search({ action: "find", query: "parseProject" })
search({ action: "find", query: "graph client connection" })
search({ action: "context", file: "src/service.ts", includeRelationships: true })
search({ action: "context", symbol: "hybridSearch" })
```

### 2. `knowledge` — Knowledge graph

| Action | Use When | Required Params |
|--------|----------|-----------------|
| `store_entity` | Record a concept, decision, person, project | `text`, `type` |
| `store_relationship` | Connect two entities | `headText`, `headType`, `tailText`, `tailType`, `type` |
| `store_fact` | Extract entities from text | `text` |
| `query` | Search entities by type/text/semantic | (at least one filter) |
| `recall` | "What do I know about X?" | `text` |
| `ingest` | Bulk-load conversations | `text` |

### 3. `codebase` — Index management

| Action | Use When | Required Params |
|--------|----------|-----------------|
| `configure` | Set up or change active projects | `projectAction` |
| `reindex` | Refresh the index | (none, defaults to incremental) |
| `status` | Check indexing progress | (none) |
| `stats` | Graph node/edge counts | (none) |
| `source` | Read source code | `path` |
| `ping` | Test connectivity | (none) |

### 4. `query` — Raw Cypher (power users)

Execute read-only Cypher against the code graph.

**Schema:** Nodes: File, Function, Class, Interface, Variable, Type, Component, Entity. Edges: CONTAINS, CALLS, IMPORTS, EXTENDS, IMPLEMENTS, ABOUT, RELATES_TO.

```
query({ cypher: "MATCH (f:Function) WHERE f.name CONTAINS $name RETURN f.name, f.filePath LIMIT 20", params: { name: "parse" } })
```

## Workflow Guides

### Codebase Onboarding
1. `codebase({ action: "stats" })` — get overview
2. `search({ action: "find", query: "main index app" })` — find entry points
3. `search({ action: "context", file: "<entry_point>", includeRelationships: true })` — understand architecture

### Find and Understand Code
1. `search({ action: "find", query: "authentication" })` — find relevant symbols
2. `search({ action: "context", symbol: "<result>" })` — see callers, imports, relationships
3. `codebase({ action: "source", path: "<file>" })` — read the actual code

### Knowledge Capture
1. `knowledge({ action: "ingest", text: "<conversation>", format: "chat" })` — extract entities
2. `knowledge({ action: "recall", text: "<topic>" })` — retrieve what was captured

## Anti-Patterns

- **Don't** pass raw user input to `query` — use parameterized queries with `params`
- **Don't** fetch everything — always use `limit` and `scope` to constrain results
- **Don't** use `query` for things `search` can do — `search` has better defaults
- **Don't** call `reindex` repeatedly — use `mode: "incremental"`

## Environment

- **Graph DB**: FalkorDB (Docker) or FalkorDBLite (embedded)
- **Build**: `pnpm turbo build` (monorepo with Turbo)
- **Test**: `pnpm turbo test`
