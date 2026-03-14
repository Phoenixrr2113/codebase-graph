# CodeGraph — AI Assistant Skill Document

CodeGraph is a code intelligence platform that indexes codebases into a graph database (FalkorDB) and provides 5 MCP tools for search, analysis, knowledge management, indexing, and raw graph queries.

## Quick Start

Before using any tools, check if a codebase is indexed:
```
codebase({ action: "status" })
```

If no projects are configured:
```
codebase({ action: "configure", projectAction: "set", projects: ["/path/to/project"] })
codebase({ action: "reindex", mode: "full" })
```

## Tool Reference

### 1. `search` — Find and understand code

| Action | Use When | Required Params |
|--------|----------|-----------------|
| `find` | Looking for files, functions, classes, symbols | `query` |
| `context` | Need relationships and structure for a file or symbol | `file` or `symbol` |
| `ask` | Natural language question about the code | `query` |
| `cypher` | Translate NL to Cypher and execute | `query` |
| `explain` | Understand code with deps, tests, complexity | `file` |
| `map` | Get condensed codebase overview for LLM context | (none) |

**Examples:**
```
search({ action: "find", query: "parseProject", type: "function" })
search({ action: "context", file: "src/service.ts", includeRelationships: true })
search({ action: "ask", query: "how does the search pipeline work?" })
search({ action: "explain", file: "src/pipeline.ts", startLine: 100, endLine: 200 })
search({ action: "map", maxTokens: 4096, focusFiles: ["src/service.ts"] })
```

### 2. `analyze` — Code quality, security, and impact

| Action | Use When | Required Params |
|--------|----------|-----------------|
| `impact` | Changing a symbol — what breaks? | `symbol` |
| `vulnerabilities` | Security scan | (none, defaults to all) |
| `complexity` | Find complex hotspots | (none, defaults to all) |
| `refactoring` | Identify extraction candidates | `file` |
| `dataflow` | Trace data from source to sink | `source`, `file` |
| `history` | Git history for a symbol | `symbol` |

**Examples:**
```
analyze({ action: "impact", symbol: "parseProject", depth: 3 })
analyze({ action: "vulnerabilities", severity: "critical", scope: "src/api" })
analyze({ action: "complexity", threshold: 15, sortBy: "cognitive" })
analyze({ action: "refactoring", file: "src/service.ts" })
```

### 3. `knowledge` — Knowledge graph CRUD

| Action | Use When | Required Params |
|--------|----------|-----------------|
| `store_entity` | Record a concept, decision, person, project | `text`, `type` |
| `store_relationship` | Connect two entities | `headText`, `headType`, `tailText`, `tailType`, `type` |
| `store_fact` | Extract entities from text via LLM | `text` |
| `query` | Search entities by type/text/semantic | (at least one filter) |
| `recall` | "What do I know about X?" | `text` |
| `maintain` | Decay/prune stale knowledge | (none) |
| `ingest` | Bulk-load conversations | `text` |
| `stats` | Knowledge graph size | (none) |

### 4. `codebase` — Index management

| Action | Use When | Required Params |
|--------|----------|-----------------|
| `configure` | Set up or change active projects | `projectAction` |
| `reindex` | Refresh the index | (none, defaults to incremental) |
| `status` | Check indexing progress | (none) |
| `stats` | Graph node/edge counts | (none) |
| `source` | Read source code | `path` |
| `ping` | Test connectivity | (none) |

### 5. `query` — Raw Cypher (power users)

Execute read-only Cypher against the code graph. Use `search` and `analyze` first — this is the escape hatch.

**Schema:** Nodes: File, Function, Class, Interface, Variable, Type, Component, Entity. Edges: CONTAINS, CALLS, IMPORTS, EXTENDS, IMPLEMENTS, ABOUT, RELATES_TO.

```
query({ cypher: "MATCH (f:Function) WHERE f.name CONTAINS $name RETURN f.name, f.filePath LIMIT 20", params: { name: "parse" } })
```

## Workflow Guides

### Security Scan
1. `analyze({ action: "vulnerabilities", severity: "critical" })` — find critical issues
2. For each finding: `analyze({ action: "impact", symbol: "<vulnerable_function>" })` — assess blast radius
3. `search({ action: "find", query: "<pattern>", scope: "src/" })` — find similar patterns
4. Generate report with severity, impact, and remediation

### Codebase Onboarding
1. `codebase({ action: "stats" })` — get overview (node counts, largest files)
2. `search({ action: "map", maxTokens: 4096 })` — condensed codebase overview
3. `search({ action: "find", query: "main index app", type: "file" })` — find entry points
4. `search({ action: "context", file: "<entry_point>", includeRelationships: true })` — understand architecture

### Impact Check Before Refactoring
1. `analyze({ action: "impact", symbol: "<target>", depth: 3 })` — find all callers/dependents
2. `search({ action: "context", symbol: "<target>", includeRelationships: true })` — see relationships
3. `analyze({ action: "complexity", scope: "<file>" })` — check complexity
4. `analyze({ action: "refactoring", file: "<file>" })` — identify extraction candidates

### Knowledge Capture (Meeting/Discussion)
1. `knowledge({ action: "ingest", text: "<conversation>", format: "chat" })` — extract entities
2. `knowledge({ action: "recall", text: "<project_name>" })` — verify what was captured
3. `knowledge({ action: "maintain" })` — periodic cleanup of stale knowledge

## Anti-Patterns

- **Don't** scan test files for vulnerabilities — use `scope` to target production code
- **Don't** call `codebase({ action: "status" })` before every query — it's cached
- **Don't** pass raw user input to `query` — use parameterized queries with `params`
- **Don't** fetch everything — always use `limit` and `scope` to constrain results
- **Don't** use `query` for things `search` can do — `search` has better defaults and guardrails
- **Don't** call `reindex` repeatedly — use `mode: "incremental"` and let the watcher handle file changes

## Environment

- **Graph DB**: FalkorDB (Docker) or FalkorDBLite (embedded)
- **Build**: `pnpm turbo build` (monorepo with Turbo)
- **Test**: `pnpm turbo test`
- **Raw tools**: Set `CODEGRAPH_RAW_TOOLS=true` to expose individual MCP tools alongside personas
