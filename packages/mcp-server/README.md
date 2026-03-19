# @codegraph/mcp-server

MCP (Model Context Protocol) server for CodeGraph. Provides **4 persona tools** that consolidate underlying capabilities into a simple interface for AI assistants (Claude, Cursor, etc.).

## Persona Tools (Default)

By default, the server exposes 4 high-level persona tools. Each tool accepts an `action` parameter and routes internally to the appropriate underlying operations, with built-in input validation, result limits, and error handling.

### search

Find code, symbols, and understand structure across the codebase.

| Action | Description |
|--------|-------------|
| `find` | Search for files, functions, classes by name or meaning (vector + reranking) |
| `context` | Get detailed context for a file or symbol with relationships |

### knowledge

Store and recall domain knowledge with temporal memory.

| Action | Description |
|--------|-------------|
| `store` | Auto-detects type and stores entity, relationship, fact, or conversation |
| `recall` | Recall everything known about a topic |

### codebase

Manage and inspect the indexed codebase.

| Action | Description |
|--------|-------------|
| `configure` | View and manage active codebases (list, set, add, remove, status) |
| `reindex` | Trigger incremental or full reindex |
| `status` | Get current index status (node/edge counts by type) |
| `stats` | Get detailed graph statistics (counts, largest files, most connected) |
| `source` | Read source code from a file with optional line range |
| `ping` | Test connectivity |

### query

Execute read-only Cypher queries against the graph.

| Action | Description |
|--------|-------------|
| `cypher` | Execute a validated, read-only Cypher query with params |

## Raw Tools

For power users, set `CODEGRAPH_RAW_TOOLS=1` to expose individual tools instead of persona tools:

| Category | Tools |
|----------|-------|
| Core | `ping`, `configure_projects` |
| Index | `trigger_reindex`, `get_stats` |
| Search | `search_code`, `get_context`, `query_graph` |
| Source | `get_source` |
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

- `consolidated.test.ts` — Core tools (ping, configure, search, context, query)
- `legacy.test.ts` — Legacy tool tests (needs cleanup for removed tools)
- `knowledge.test.ts` — Knowledge graph tools (store, recall, decay)
- `e2e-knowledge.test.ts` — End-to-end knowledge pipeline

All tests run against real FalkorDB database with extracted data (no mocks).

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
