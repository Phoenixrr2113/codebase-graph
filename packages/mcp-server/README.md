# @codegraph/mcp-server

MCP (Model Context Protocol) server for CodeGraph. Provides **28 tools** for AI assistants (Claude, Cursor, etc.) to query, search, analyze, and build knowledge from a codebase knowledge graph.

## Tools (28)

### Core Tools

| Tool | Description |
|------|-------------|
| `ping` | Test server connectivity |
| `configure_projects` | View and manage which codebases are in context |

### Index & Status

| Tool | Description |
|------|-------------|
| `get_index_status` | Get current index status including file counts and last update |
| `trigger_reindex` | Trigger a reindex of the codebase (incremental or full) |
| `get_stats` | Graph-wide statistics: node/edge counts, largest files, most connected entities |
| `get_source` | Read source code from a file with optional line range |

### Search & Discovery

| Tool | Description |
|------|-------------|
| `search` | Find files, functions, classes by name or keyword |
| `find_symbol` | Find a symbol by name and return its definition with source code |
| `search_code` | Hybrid search (vector + text + graph + knowledge) |
| `get_context` | Get detailed context for a file or symbol with relationships |
| `query_graph` | Execute read-only Cypher queries for advanced analysis |
| `get_repo_map` | Get a ranked map of important symbols for LLM context |

### AI-Powered Search

| Tool | Description |
|------|-------------|
| `ask_code` | Ask a natural language question and get an AI-synthesized answer |
| `query_cypher` | Translate natural language to Cypher, execute, and return results |

### Analysis

| Tool | Description |
|------|-------------|
| `analyze_impact` | Find all code affected by changing a symbol (callers, tests, risk) |
| `find_vulnerabilities` | Scan for security vulnerabilities using dataflow analysis |
| `get_complexity_report` | Generate complexity report with hotspots |
| `trace_data_flow` | Track data flow from source to sink |
| `explain_code` | Get code with context: dependencies, tests, complexity metrics |
| `get_symbol_history` | Get git commit history for a specific symbol |
| `analyze_file_for_refactoring` | Identify extraction candidates and refactoring opportunities |

### Knowledge Graph

| Tool | Description |
|------|-------------|
| `store_entity` | Store an entity in the knowledge graph (deduplicates by text+type) |
| `store_relationship` | Store a relationship between two entities |
| `store_fact` | Extract entities/relationships from natural language via LLM |
| `ingest_conversation` | Ingest a multi-turn conversation into the knowledge graph |
| `query_knowledge` | Search knowledge graph by type, text, or semantic similarity |
| `recall` | Recall everything known about an entity (all relationships) |
| `decay_and_prune` | Run temporal memory maintenance: decay relevance, prune stale entities |

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

The `search_code` and `ask_code` tools support multiple search strategies:

| Strategy | Description |
|----------|-------------|
| `VECTOR` | Pure vector similarity search using embeddings |
| `HYBRID` | Combined vector + text + graph traversal |
| `GRAPH_ANSWER` | LLM synthesizes answer by traversing the graph |
| `NL_TO_CYPHER` | LLM translates natural language to Cypher query |
| `SMART_SEARCH` | Auto-routes to the best strategy based on query type |
| `CONTEXT_WALK` | LLM-guided iterative graph exploration |

## Testing

```bash
# Run from the mcp-server package directory
cd packages/mcp-server
pnpm exec vitest run

# Or from the monorepo root
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

### Test Data Requirements

Tests require an extracted codebase in FalkorDB. Start Docker FalkorDB first:

```bash
pnpm docker:db  # Start FalkorDB on localhost:6379
```

## Architecture

The server uses the `@modelcontextprotocol/sdk` with `StdioServerTransport`:

```
MCP Client (Claude, Cursor, etc.)
  │ stdio
  ▼
CodeGraphMCPServer
  ├── Tool Registry (28 tools, dynamic descriptions)
  ├── Config Sync (initialSync on startup)
  └── Graceful Shutdown (SIGINT/SIGTERM)
        │
        ▼
  @codegraph/core (service layer, search, analysis)
        │
        ▼
  @codegraph/graph (database driver)
```

On startup, the server runs `initialSync()` to sync configuration to the graph database. Tool descriptions are dynamically enriched with schema and file-tree context from the active project.
