# CodeGraph: AI Assistant Skill Document

CodeGraph indexes codebases into a graph database (FalkorDB) and provides MCP tools for code search, context retrieval, repository analysis, knowledge management, and raw graph queries.

## Quick Start

Check if a codebase is indexed:
```
codebase({ action: "status" })
```

On a fresh install this returns `configured: false` and `setupRequired: true`. An empty database is valid and ready for setup.

If no projects are configured, save an absolute project path and then index it:
```
codebase({ action: "configure", projectAction: "set", projects: ["/path/to/project"] })
codebase({ action: "reindex", mode: "full", scope: "/path/to/project" })
```

Configuration does not index the project. Reindexing parses structure first and finishes embeddings. With no provider or provider key set, local `nomic-ai/nomic-embed-text-v1.5` embeddings are the default. The first use downloads approximately 132 MiB and reports progress.

## Tool Reference (5 tool groups, 25 actions)

### 1. `search`: Find code and knowledge

Vector search with optional cross-encoder reranking when a supported provider key is configured. Without one, search keeps vector-search ordering. Local 768-dimension embeddings remain the no-key default. Results include complexity, callers, callees, importerCount, and linkedKnowledge.

| Action | Use When | Required Params |
|--------|----------|-----------------|
| `find` | Looking for files, functions, classes, symbols | `query` |
| `context` | Need relationships and structure for a file or symbol | `file` or `symbol` |

**Search modes:** `searchScope: 'code'` (default), `'knowledge'`, `'all'` (RRF fusion).

**Examples:**
```
search({ action: "find", query: "parseProject" })
search({ action: "find", query: "authentication", searchScope: "all" })
search({ action: "context", file: "src/service.ts", includeRelationships: true })
search({ action: "context", symbol: "enrichedSearchV2" })
```

**Multi-step questions:** for complex queries that need iterative refinement, chain `search` calls in your agent. Examine results, refine the query, and search again. CodeGraph stays focused on per-call retrieval quality; orchestration is the agent's job.

### 2. `knowledge`: Knowledge graph (8 actions)

| Action | Use When | Required Params |
|--------|----------|-----------------|
| `store` | Store entities, relationships, or extract facts from text | `text` |
| `add` | Ingest a document (PDF, DOCX, HTML, CSV, URL, or raw text) | `input` |
| `recall` | "What do I know about X?", with temporal and speaker queries | `text` |
| `query_knowledge` | Search entities by type, text, source, or fact meaning | (any filter) |
| `ingest_conversation` | Ingest multi-turn conversation with speaker attribution | `text` |
| `resolve_entities` | On-demand 3-tier entity deduplication | (none) |
| `decay_and_prune` | Temporal maintenance: decay relevance, prune stale entities | (none) |
| `get_knowledge_stats` | Memory statistics | (none) |

**Recall parameters (all optional):**
- `at`: ISO timestamp for point-in-time: "what was true on March 1st?"
- `from` / `to`: time range: "what changed this week?"
- `timeline: true`: full chronological history including superseded facts
- `minRelevance`: relevance-weighted search (0-1 threshold)
- `speaker`: "what has Alice said?" (follows SAID relationships)
- `includeHistory: true`: include invalidated/superseded facts

**Query parameters (all optional):**
- `semanticQuery`: find entities by meaning, not just text
- `searchFacts`: search relationship explanations by meaning
- `source`: filter by provenance/sampleId prefix

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

### 3. `codebase`: Index management

| Action | Use When | Required Params |
|--------|----------|-----------------|
| `configure` | Set up or change active projects | `projectAction` |
| `reindex` | Refresh the index | (none, defaults to incremental; optional `historySince`, `historyMaxCommits`) |
| `status` | Check indexing progress | (none) |
| `stats` | Graph node/edge counts | (none) |
| `source` | Read source code | `path` |
| `ping` | Test connectivity | (none) |
| `profile` | Get a fast static and dynamic project snapshot | (none) |

The `profile` handler is intended to accept an optional absolute `projectPath` filter and an optional `limit` (default 10). Its published input schema currently omits both properties, so clients that enforce the schema cannot reliably send them. Calling `profile` without either property remains schema-valid and returns the unfiltered snapshot.

Widen the persisted git history window during reindexing when deeper history is needed:
```
codebase({ action: "reindex", mode: "full", scope: "/path/to/project", historySince: "2024-01-01T00:00:00Z", historyMaxCommits: 20000 })
```

### 4. `analyze`: Bounded repository analysis

Use purpose-built static and history analysis instead of hand-writing Cypher.

| Action | Use When | Required Params |
|--------|----------|-----------------|
| `impact` | Need the static blast radius of a persisted symbol | `id` |
| `import_cycles` | Need canonical import cycles within a project | `projectPath` |
| `call_hierarchy` | Need direct callers, callees, or both | `id` |
| `dead_code` | Need unreferenced export candidates | `projectPath` |
| `hotspots` | Need frequently changed files ranked by current complexity or degree | `projectPath` |
| `change_coupling` | Need file pairs that change together | `projectPath` |
| `ownership` | Need per-file authorship contributors ranked from indexed git history | `projectPath` |

**Examples:**
```
analyze({ action: "impact", id: "sym:v1:<64 lowercase hex characters>", depth: 3, limit: 100 })
analyze({ action: "import_cycles", projectPath: "/path/to/project", maxDepth: 25, limit: 100 })
analyze({ action: "call_hierarchy", id: "sym:v1:<64 lowercase hex characters>", direction: "both", limit: 100 })
analyze({ action: "dead_code", projectPath: "/path/to/project", limit: 100 })
analyze({ action: "hotspots", projectPath: "/path/to/project", since: "2026-01-01", scoreBy: "complexity", limit: 100 })
analyze({ action: "change_coupling", projectPath: "/path/to/project", since: "2026-01-01", minSupport: 2, limit: 100 })
analyze({ action: "ownership", projectPath: "/path/to/project", since: "2026-01-01", pathPrefix: "src", limit: 50 })
```

Every result carries display-ready caveat strings and truncation metadata from the analysis layer. Hotspots, change coupling, and ownership also report `historyCoverage`, including the observed commit count and date range. Ownership is inferred from authorship in indexed git history, not from CODEOWNERS, review activity, expertise, or current team assignment. Impact, call hierarchy, import cycles, and unreferenced exports are static evidence, not proof of runtime behavior. Dead-code results are candidates and must never drive automated deletion. Git-backed results cover indexed history only. Indexed history is bounded by the persisted history window (365 days and 10000 commits by default); widen it by reindexing with an earlier `historySince`.

### 5. `query`: Raw Cypher (power users)

Execute read-only Cypher against the code graph.

**Schema:** Nodes: File, Function, Class, Interface, Variable, Type, Component, TypeRef, Entity, Project, Commit, Metadata, MarkdownDocument, Section, CodeBlock, Link. Edges: CONTAINS, IMPORTS, IMPORTS_SYMBOL, CALLS, EXTENDS, IMPLEMENTS, USES_TYPE, RETURNS, HAS_PARAM, HAS_METHOD, HAS_PROPERTY, RENDERS, INTRODUCED_IN, MODIFIED_IN, DELETED_IN, EXPORTS, PARENT_SECTION, ABOUT, RELATES_TO. SAID is not a separate edge label: it is a RELATES_TO edge with a `type` property set to "SAID", like every other relationship kind carried by RELATES_TO.

```
query({ cypher: "MATCH (f:Function) WHERE f.name CONTAINS $name RETURN f.name, f.filePath LIMIT 20", params: { name: "parse" } })
```

## Workflow Guides

### Codebase Onboarding
1. `codebase({ action: "stats" })`: get overview
2. `search({ action: "find", query: "main index app" })`: find entry points
3. `search({ action: "context", file: "<entry_point>", includeRelationships: true })`: understand architecture

### Find and Understand Code
1. `search({ action: "find", query: "authentication" })`: find relevant symbols
2. `search({ action: "context", symbol: "<result>" })`: see callers, imports, relationships
3. `codebase({ action: "source", path: "<file>" })`: read the actual code

### Unified Search (Code + Knowledge)
1. `search({ action: "find", query: "retry logic", searchScope: "all" })`: search both code and knowledge
2. Results include both code symbols and knowledge entities, ranked by RRF fusion

### Analyze Change Risk
1. `analyze({ action: "impact", id: "<persisted-symbol-id>" })`: inspect the bounded static blast radius
2. `analyze({ action: "call_hierarchy", id: "<persisted-symbol-id>", direction: "both" })`: inspect direct callers and callees
3. Read every returned caveat and truncation field before drawing a conclusion

### Analyze Repository Health
1. `analyze({ action: "import_cycles", projectPath: "<absolute-project-path>" })`: find canonical cycles
2. `analyze({ action: "dead_code", projectPath: "<absolute-project-path>" })`: review unreferenced export candidates
3. `analyze({ action: "hotspots", projectPath: "<absolute-project-path>" })`: rank frequently changed files
4. `analyze({ action: "change_coupling", projectPath: "<absolute-project-path>" })`: find correlated file changes
5. `analyze({ action: "ownership", projectPath: "<absolute-project-path>" })`: review inferred per-file authorship contributors
6. Treat `historyCoverage` as the observed indexed window, not all-time repository history. Ownership reflects authorship inferred from that indexed history, not CODEOWNERS, review activity, expertise, or current team assignment.

### Ingest Documents
1. `knowledge({ action: "add", input: "/path/to/spec.pdf" })`: auto-detects format, chunks, extracts entities
2. Supported: PDF, DOCX, HTML, CSV, URLs, raw text

### Temporal Knowledge Queries
1. `knowledge({ action: "recall", text: "auth system", at: "2026-01-15T00:00:00Z" })`: point-in-time reconstruction
2. `knowledge({ action: "recall", text: "decisions", from: "2026-03-01", to: "2026-03-31" })`: what changed in March
3. `knowledge({ action: "recall", text: "AuthModule", timeline: true })`: full entity history

### Knowledge Capture
1. `knowledge({ action: "store", text: "<conversation>" })`: extract and store entities
2. `knowledge({ action: "recall", text: "<topic>" })`: retrieve what was captured

## Anti-Patterns

- **Don't** pass raw user input to `query`. Use parameterized queries with `params`
- **Don't** fetch everything. Always use `limit` and `scope` to constrain results
- **Don't** use `query` for things `search` or `analyze` can do. The purpose-built tools have safer bounds and clearer caveats.
- **Don't** call `codebase({ action: "reindex" })` repeatedly. Use `mode: "incremental"` (the default)

## Environment

- **Graph DB**: Embedded FalkorDBLite on Linux x64 and Apple silicon macOS. Apple silicon requires Homebrew `libomp` and `openssl@3`. Other platforms use external FalkorDB.
- **Storage concurrency**: One database server runs per data directory. A second CodeGraph process attaches to it.
- **Search**: Local 768-dimension embeddings are the no-key default. Voyage and OpenRouter require their provider keys. `none` is the explicit structural-only option.
- **Embedding migration**: A provider, model, or dimension switch requires an explicit re-embed migration or a full reindex.
- **Dashboard and API**: One `codegraph-dashboard` process serves both on the URL it prints. A fresh database opens on guided setup with Browse, indexing, and progress.
- **Build**: `pnpm build` (monorepo with Turbo)
- **Test**: `pnpm test`

## Public Benchmark: CGBench v1

Cross-system retrieval benchmark at `benchmarks/cgbench-v1/`. Compares CodeGraph against 7 named competitors on a uniform 6-task battery (NL→code, structural, multi-hop, bitemporal, linked code+knowledge, document ingestion). Results published in [`benchmarks/cgbench-v1/BENCHMARKS.md`](benchmarks/cgbench-v1/BENCHMARKS.md). Methodology: [`benchmarks/cgbench-v1/COMPETITORS.md`](benchmarks/cgbench-v1/COMPETITORS.md), [`benchmarks/cgbench-v1/questions/REVIEW.md`](benchmarks/cgbench-v1/questions/REVIEW.md).
