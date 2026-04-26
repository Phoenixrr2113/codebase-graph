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

## Tool Reference (4 tool groups, 17 actions)

### 1. `search` — Find code and knowledge

Vector search + cross-encoder reranking. Returns enriched results with complexity, callers, callees, importerCount, linkedKnowledge.

| Action | Use When | Required Params |
|--------|----------|-----------------|
| `find` | Looking for files, functions, classes, symbols | `query` |
| `context` | Need relationships and structure for a file or symbol | `file` or `symbol` |

**Search modes:** `searchScope: 'code'` (default), `'knowledge'`, `'all'` (RRF fusion). `mode: 'cot'` for chain-of-thought iterative search.

**Examples:**
```
search({ action: "find", query: "parseProject" })
search({ action: "find", query: "authentication", searchScope: "all" })
search({ action: "find", query: "why does payment retry 3 times?", mode: "cot" })
search({ action: "context", file: "src/service.ts", includeRelationships: true })
search({ action: "context", symbol: "enrichedSearchV2" })
```

### 2. `knowledge` — Knowledge graph (8 actions)

| Action | Use When | Required Params |
|--------|----------|-----------------|
| `store` | Store entities, relationships, or extract facts from text | `text` |
| `add` | Ingest a document (PDF, DOCX, HTML, CSV, URL, or raw text) | `input` |
| `recall` | "What do I know about X?" — with temporal and speaker queries | `text` |
| `query_knowledge` | Search entities by type, text, source, or fact meaning | (any filter) |
| `ingest_conversation` | Ingest multi-turn conversation with speaker attribution | `text` |
| `resolve_entities` | On-demand 3-tier entity deduplication | (none) |
| `decay_and_prune` | Temporal maintenance — decay relevance, prune stale entities | (none) |
| `get_knowledge_stats` | Memory statistics | (none) |

**Recall parameters (all optional):**
- `at` — ISO timestamp for point-in-time: "what was true on March 1st?"
- `from` / `to` — time range: "what changed this week?"
- `timeline: true` — full chronological history including superseded facts
- `minRelevance` — relevance-weighted search (0-1 threshold)
- `speaker` — "what has Alice said?" (follows SAID relationships)
- `includeHistory: true` — include invalidated/superseded facts

**Query parameters (all optional):**
- `semanticQuery` — find entities by meaning, not just text
- `searchFacts` — search relationship explanations by meaning
- `source` — filter by provenance/sampleId prefix

**Examples:**
```
knowledge({ action: "store", text: "We decided to use JWT for auth because..." })
knowledge({ action: "add", input: "/path/to/spec.pdf", source: "product-spec-v2" })
knowledge({ action: "add", input: "https://docs.example.com/api", source: "api-docs" })
knowledge({ action: "recall", text: "AuthModule", timeline: true })
knowledge({ action: "recall", text: "payment system", at: "2026-03-01T00:00:00Z" })
knowledge({ action: "recall", text: "decisions", from: "2026-03-01", to: "2026-03-31" })
knowledge({ action: "recall", text: "anything", speaker: "Alice" })
knowledge({ action: "recall", text: "hot topics", minRelevance: 0.7 })
knowledge({ action: "query_knowledge", searchFacts: "who decided to use JWT?" })
knowledge({ action: "query_knowledge", source: "meeting-2024-01-15" })
knowledge({ action: "ingest_conversation", text: "Alice: let's use Redis\nBob: agreed", source: "standup" })
knowledge({ action: "resolve_entities" })
```

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

**Schema:** Nodes: File, Function, Class, Interface, Variable, Type, Component, Entity. Edges: CONTAINS, CALLS, IMPORTS, EXTENDS, IMPLEMENTS, ABOUT, RELATES_TO, SAID.

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

### Unified Search (Code + Knowledge)
1. `search({ action: "find", query: "retry logic", searchScope: "all" })` — search both code and knowledge
2. Results include both code symbols and knowledge entities, ranked by RRF fusion

### Chain-of-Thought Search (Complex Questions)
1. `search({ action: "find", query: "why does payment retry 3 times?", mode: "cot" })` — iterative LLM refinement
2. System searches → validates → generates follow-up queries → merges results

### Ingest Documents
1. `knowledge({ action: "add", input: "/path/to/spec.pdf" })` — auto-detects format, chunks, extracts entities
2. Supported: PDF, DOCX, HTML, CSV, URLs, raw text

### Temporal Knowledge Queries
1. `knowledge({ action: "recall", text: "auth system", at: "2026-01-15T00:00:00Z" })` — point-in-time reconstruction
2. `knowledge({ action: "recall", text: "decisions", from: "2026-03-01", to: "2026-03-31" })` — what changed in March
3. `knowledge({ action: "recall", text: "AuthModule", timeline: true })` — full entity history

### Knowledge Capture
1. `knowledge({ action: "store", text: "<conversation>" })` — extract and store entities
2. `knowledge({ action: "recall", text: "<topic>" })` — retrieve what was captured

## Anti-Patterns

- **Don't** pass raw user input to `query` — use parameterized queries with `params`
- **Don't** fetch everything — always use `limit` and `scope` to constrain results
- **Don't** use `query` for things `search` can do — `search` has better defaults
- **Don't** call `reindex` repeatedly — use `mode: "incremental"`

## Environment

- **Graph DB**: FalkorDB (Docker) or FalkorDBLite (embedded)
- **Search**: Vector embeddings (local/Voyage/OpenRouter) + cross-encoder reranking (Jina/Voyage) — MRR 0.969, S@1 94%, S@5 100%, ~450ms latency (v6 Chunk 1 baseline, 2026-04-26)
- **Dashboard**: `http://localhost:3000/dashboard` (Graph Explorer + Operations tabs)
- **API**: `http://localhost:3001` (REST endpoints for dashboard)
- **Build**: `pnpm turbo build` (monorepo with Turbo)
- **Test**: `pnpm turbo test`
