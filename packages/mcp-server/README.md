# @codegraph/mcp-server

MCP (Model Context Protocol) server for CodeGraph. Provides **4 persona tools** that consolidate underlying capabilities into a simple interface for AI assistants (Claude, Cursor, etc.).

## Persona Tools (Default)

By default, the server exposes 4 high-level persona tools. Each tool accepts an `action` parameter and routes internally to the appropriate underlying operations, with built-in input validation, result limits, and error handling.

### search

Find code, symbols, and answers across the codebase.

| Action | Description |
|--------|-------------|
| `find` | Find files, functions, classes by name or keyword |
| `context` | Get detailed context for a file or symbol with relationships |
| `ask` | Ask a natural language question — auto-routes to best search strategy |
| `cypher` | Translate natural language to Cypher and execute |
| `explain` | Get code with context: dependencies, tests, complexity metrics |

### knowledge

Store and recall domain knowledge with temporal memory.

| Action | Description |
|--------|-------------|
| `store_entity` | Store an entity (deduplicates by text+type) |
| `store_relationship` | Store a relationship between entities |
| `store_fact` | Extract entities/relationships from natural language via LLM |
| `ingest` | Ingest a multi-turn conversation into the knowledge graph |
| `query` | Search knowledge graph by type, text, or semantic similarity |
| `recall` | Recall everything known about an entity |
| `maintain` | Run temporal decay and pruning |
| `stats` | Knowledge graph health metrics |

### codebase

Manage and inspect the indexed codebase.

| Action | Description |
|--------|-------------|
| `status` | Get current index status (file counts, last update) |
| `structure` | Get codebase file tree and structure |
| `source` | Read source code from a file with optional line range |
| `reindex` | Trigger incremental or full reindex |
| `stats` | Graph-wide statistics (node/edge counts, most connected entities) |
| `map` | Get a ranked map of important symbols for LLM context |
| `configure` | View and manage which codebases are in context |

### query

Execute read-only Cypher queries against the graph.

| Action | Description |
|--------|-------------|
| `cypher` | Execute a validated, read-only Cypher query |

## Raw Tools

For power users, set `CODEGRAPH_RAW_TOOLS=1` to expose individual tools instead of persona tools:

| Category | Tools |
|----------|-------|
| Core | `ping`, `configure_projects` |
| Index | `get_index_status`, `trigger_reindex`, `get_stats` |
| Search | `search_code`, `get_context`, `query_graph` |
| Context | `get_repo_map`, `get_source` |
| Knowledge | `store_entity`, `store_relationship`, `store_fact`, `ingest_conversation`, `query_knowledge`, `recall`, `decay_and_prune`, `get_knowledge_stats` |

## MCP Configuration

Add to your MCP client config (Claude Desktop, Cursor, etc.):

```json
{
  "codegraph": {
    "command": "node",
    "args": ["./packages/mcp-server/dist/index.js"]
  }
}
```

The server auto-detects the database backend from `.codegraph/config.json` or environment variables. See the [root README](../../README.md) for configuration details.

## Search Strategies

The search persona's `ask` action supports multiple search strategies:

| Strategy | Description |
|----------|-------------|
| `HYBRID` | Combined vector + text + graph traversal with RRF fusion |
| `ENRICHED_V2` | Vector retrieval + cross-encoder reranking (primary) |

## Input Validation

All persona tools enforce consistent guardrails:

- **Path validation** — file paths restricted to active project directories (prevents path traversal)
- **Query length** — max 10KB query strings
- **Result limits** — clamped to 1,000 max, default 20
- **Cypher safety** — read-only enforcement, label allowlists, parameterized queries

## Testing

```bash
cd packages/mcp-server
pnpm exec vitest run

# Or from monorepo root
pnpm test --filter=@codegraph/mcp-server
```

### Test Suite

- **5 test files** covering all tool categories
- `consolidated.test.ts` — Core tools (ping, configure, search, context, query)
- `legacy.test.ts` — Analysis and context tools
- `knowledge.test.ts` — Knowledge graph tools (store, recall, decay)
- `e2e-knowledge.test.ts` — End-to-end knowledge pipeline
- `search-strategies.test.ts` — Search strategy routing and execution
- All tests run against real FalkorDB database with extracted data (no mocks)

## Architecture

```
MCP Client (Claude, Cursor, etc.)
  │ stdio
  ▼
CodeGraphMCPServer
  ├── Persona Handlers (search, knowledge, codebase, query)
  │     ├── Input Validation (validation.ts)
  │     └── Action Routing → underlying tool implementations
  ├── Raw Tool Registry (opt-in via CODEGRAPH_RAW_TOOLS=1)
  └── Graceful Shutdown (SIGINT/SIGTERM)
        │
        ▼
  @codegraph/core (service layer, search)
        │
        ▼
  @codegraph/graph (database driver)
```
