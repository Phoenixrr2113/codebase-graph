# CodeGraph

A code knowledge graph and search system for AI agents. Indexes your codebase into a graph database, embeds symbols and documentation, and exposes search through a Model Context Protocol (MCP) server.

## What it does

- **Search code by meaning** — vector embeddings + cross-encoder reranking find the function, class, or interface you describe, even when you don't know the name. Internal benchmark: MRR 0.969, Success@1 94%, Success@5 100%, ~447ms latency on a project of ~2.3K nodes.
- **Understand structure** — tree-sitter parsers extract Functions, Classes, Interfaces, Variables, and Types across 5 first-class languages (TypeScript, Python, Go, Rust, Markdown), with tree-sitter coverage for additional languages via the generic plugin.
- **Track decisions over time** — bitemporal knowledge graph stores facts with `valid_at` / `invalid_at` timestamps, supporting point-in-time queries ("what was true on March 1st?").
- **Plug into AI agents** — exposes 4 MCP tool groups (`search`, `knowledge`, `codebase`, `query`) for use in Claude Desktop, Cursor, Claude Code, or any MCP client.

## Quickstart

```bash
git clone https://github.com/Phoenixrr2113/codebase-graph.git
cd codebase-graph
pnpm install
pnpm build

# Option A — embedded database (no Docker required)
brew install redis  # macOS — FalkorDBLite needs redis-server
echo "CODEGRAPH_DRIVER=falkordblite" > .env
echo "CODEGRAPH_DB_PATH=.codegraph/falkordb" >> .env

# Option B — FalkorDB via Docker
# pnpm docker:db
# echo "CODEGRAPH_DRIVER=falkordb" > .env

# Index a project
pnpm --filter @codegraph/cli start configure --projects /path/to/your/project
pnpm --filter @codegraph/cli start reindex

# Run the MCP server (stdio transport)
pnpm --filter @codegraph/mcp-server start
```

## Use with an MCP client

### Claude Desktop

Add to `~/Library/Application Support/Claude/claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "codegraph": {
      "command": "node",
      "args": ["/absolute/path/to/codebase-graph/packages/mcp-server/dist/index.js"],
      "env": {
        "VOYAGE_API_KEY": "your-key",
        "JINA_API_KEY": "your-key"
      }
    }
  }
}
```

### Claude Code

```bash
claude mcp add codegraph node /absolute/path/to/codebase-graph/packages/mcp-server/dist/index.js
```

## MCP tools

Four persona-based tool groups by default. Set `CODEGRAPH_RAW_TOOLS=1` to expose the underlying handlers individually.

| Tool | What it does |
|------|--------------|
| **search** | Find code/symbols by name or meaning; get context for a file or symbol |
| **knowledge** | Store and recall entities, relationships, and facts (with bitemporal queries) |
| **codebase** | Configure projects, reindex, check status/stats, read source code |
| **query** | Execute read-only Cypher against the graph (power users) |

See [CLAUDE.md](./CLAUDE.md) for the complete tool reference (parameters, examples, workflows).

## Architecture

- **Graph storage:** FalkorDB (Docker) or FalkorDBLite (embedded), with HNSW vector indexes per node type.
- **Embeddings:** pluggable — Voyage AI (`voyage-code-3`, 1024-dim), OpenRouter, or local nomic-embed via `@huggingface/transformers` (768-dim, runs on CPU).
- **Reranker:** cross-encoder via Jina (`jina-reranker-v2-base-multilingual`) or Voyage.
- **Indexer:** tree-sitter for AST parsing, SHA-256 file-hash incremental change detection.
- **MCP server:** 4 persona tools by default; raw mode exposes the underlying handlers.

## Configuration

Environment variables (set in `.env` at the repo root):

```bash
# Embedding provider (auto-detected from API keys)
CODEGRAPH_EMBEDDING_PROVIDER=voyage    # voyage | local | openrouter
VOYAGE_API_KEY=...

# Reranker provider (auto-detected from API keys)
CODEGRAPH_RERANK_PROVIDER=jina         # jina | voyage
JINA_API_KEY=...

# LLM (for knowledge extraction + chain-of-thought search)
LLM_PROVIDER=cerebras
CEREBRAS_API_KEY=...

# Graph driver
CODEGRAPH_DRIVER=falkordblite          # falkordblite | falkordb
CODEGRAPH_DB_PATH=.codegraph/falkordb  # for falkordblite
```

## Packages

| Package | Description |
|---------|-------------|
| [`@codegraph/core`](packages/core/) | Indexer, search pipelines, service layer, git sync |
| [`@codegraph/graph`](packages/graph/) | Graph DB driver abstraction, knowledge operations, Cypher templates |
| [`@codegraph/plugin-nlp`](packages/plugin-nlp/) | Embeddings, reranker, entity resolution, conversation/document ingestion |
| [`@codegraph/mcp-server`](packages/mcp-server/) | MCP server with 4 persona tools |
| [`@codegraph/api`](packages/api/) | Express REST API for the dashboard |
| [`@codegraph/cli`](packages/cli/) | CLI wrapper around the core service |
| [`@codegraph/plugin-typescript`](packages/plugin-typescript/) | TS/JS/JSX tree-sitter plugin |
| [`@codegraph/plugin-python`](packages/plugin-python/) | Python tree-sitter plugin |
| [`@codegraph/plugin-go`](packages/plugin-go/) | Go tree-sitter plugin |
| [`@codegraph/plugin-rust`](packages/plugin-rust/) | Rust tree-sitter plugin |
| [`@codegraph/plugin-markdown`](packages/plugin-markdown/) | Markdown parser |
| [`@codegraph/plugin-generic`](packages/plugin-generic/) | Tree-sitter fallback for additional languages |
| [`@codegraph/plugin-common`](packages/plugin-common/) | Shared extraction utilities (complexity, AST helpers) |
| [`@codegraph/plugin-languages`](packages/plugin-languages/) | Plugin registry coordination |
| [`@codegraph/logger`](packages/logger/) | Structured logging + tracing decorator |
| [`@codegraph/types`](packages/types/) | Shared TypeScript type definitions |

Plus `apps/web` (Next.js dashboard with Graph Explorer + Operations tabs at `localhost:3000`).

## Development

```bash
pnpm install        # Install dependencies
pnpm build          # Build all packages
pnpm dev            # Start dev mode
pnpm test           # Run all tests
pnpm docker:db      # Start FalkorDB via Docker
```

## Status

Active development. Public on 2026-04-25. No releases yet — install from source. See [docs/v6-execution-plan.md](docs/v6-execution-plan.md) for the current roadmap.

## License

MIT — see [LICENSE](./LICENSE).
