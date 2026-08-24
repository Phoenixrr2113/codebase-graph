# @codegraph/mcp-server

Private workspace implementation of the CodeGraph Model Context Protocol server. The public `@agntk/codegraph-mcp` package stages this server with its runtime dependencies and dashboard.

## Grouped tools

The default MCP surface contains five tools and 25 callable operations.

| Tool | Operations | Actions |
| --- | ---: | --- |
| `search` | 2 | `find`, `context` |
| `knowledge` | 8 | `store`, `add`, `recall`, `query_knowledge`, `ingest_conversation`, `resolve_entities`, `decay_and_prune`, `get_knowledge_stats` |
| `codebase` | 7 | `configure`, `reindex`, `status`, `stats`, `source`, `ping`, `profile` |
| `analyze` | 7 | `impact`, `import_cycles`, `call_hierarchy`, `dead_code`, `hotspots`, `change_coupling`, `ownership` |
| `query` | 1 | A direct read-only `cypher` request with optional `params` |

`ownership` ranks per-file contributors from indexed git history. It accepts an absolute `projectPath` plus optional `since`, project-relative `pathPrefix`, and `limit`. Git-backed analysis is bounded by the persisted history window and returns `historyCoverage`; all analysis results include caveats and truncation metadata.

The `codebase` `reindex` action accepts optional `historySince` and `historyMaxCommits` values. Dates use strict ISO calendar validation, and the commit ceiling must be a safe integer from 1 through 100000.

## Raw mode

Set `CODEGRAPH_RAW_TOOLS=true` using the literal string `true` to register lower-level handlers alongside the five grouped tools. Unset, `false`, and other values keep the grouped-only surface.

## Source-checkout configuration

Build the workspace before pointing an MCP client at the compiled entry:

```json
{
  "mcpServers": {
    "codegraph": {
      "command": "node",
      "args": ["/absolute/path/to/codebase-graph/packages/mcp-server/dist/index.js"]
    }
  }
}
```

Driver and embedding defaults are resolved by the shared runtime. See the [root README](../../README.md) for platform, storage, and provider behavior.

## Guardrails

- Source paths are restricted to configured project roots.
- Cypher is read-only and capped at 10 KB.
- User-supplied limits are validated or bounded per action.
- Repository-wide analysis requires an active absolute project path.
- Ownership `pathPrefix` values must remain project-relative and cannot traverse with `..` segments.
