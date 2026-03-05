# @codegraph/mcp-server

MCP (Model Context Protocol) server for CodeGraph. Provides 14 tools for AI assistants (Claude, Cursor, etc.) to query, search, and analyze a codebase knowledge graph.

## Tools

### Consolidated Tools (5)

The primary tool surface for LLM interactions:

| Tool | Description |
|------|-------------|
| `ping` | Test server connectivity |
| `configure_projects` | Setup and manage active projects |
| `search` | Find files, functions, classes by name or keyword |
| `get_context` | Get detailed context for a file or symbol with relationships |
| `query` | Execute raw Cypher queries for advanced analysis |

### Legacy Tools (14)

Full tool set with specialized analysis capabilities:

| Category | Tools |
|----------|-------|
| Index | `get_index_status`, `trigger_reindex` |
| Search | `find_symbol`, `search_code`, `query_graph` |
| Analysis | `analyze_impact`, `find_vulnerabilities`, `get_complexity_report`, `trace_data_flow` |
| Context | `explain_code`, `get_symbol_history`, `get_repo_map`, `analyze_file_for_refactoring` |

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

The server auto-detects the database backend from `.codegraph/config.json` or environment variables. Works with both FalkorDB and Kuzu.

## Testing

The MCP server has a comprehensive vitest integration test suite that runs against a real graph database (no mocks):

```bash
# Run from the mcp-server package directory
cd packages/mcp-server
pnpm exec vitest run

# Or from the monorepo root
pnpm test --filter=@codegraph/mcp-server
```

### Test Suite

- **33 integration tests** across 2 test files
- `consolidated.test.ts` — Tests all 5 consolidated tools (14 tests)
- `legacy.test.ts` — Tests all legacy tools (19 tests)
- All tests hit a real Kuzu/FalkorDB database with real extracted data
- Zero mocks — tests validate actual Cypher queries and result shapes
- Config auto-detection works from any working directory

### Test Data Requirements

Tests require an extracted codebase in the Kuzu database. Run the extraction script first:

```bash
npx tsx test-extract-kuzu.ts
```

This extracts the CodeGraph source code itself into `.codegraph/kuzu` for testing.

## Graceful Shutdown

The MCP server handles SIGINT and SIGTERM signals by closing the graph client connection before exiting. This is important for the Kuzu backend to prevent SIGSEGV on process exit (a known upstream issue with native addon destructor ordering).
