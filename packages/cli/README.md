# @codegraph/cli

Command-line interface for CodeGraph. Parse codebases, populate the graph database, generate embeddings, run searches, and execute Cypher queries.

## Installation

```
pnpm add @codegraph/cli
```

## Binary Names

```
codegraph <command> [options]
cg <command> [options]
```

## Build

```
pnpm build
```

## Commands

### `extract` -- Parse source files and populate the code graph

```
codegraph extract <path> [options]
```

Parses source files using tree-sitter, extracts entities and relationships, and stores them in FalkorDB. Optionally syncs git history.

| Option | Description | Default |
|--------|-------------|---------|
| `-g, --graph <name>` | Graph name | `codegraph` |
| `-h, --host <host>` | FalkorDB host | `localhost` |
| `-p, --port <port>` | FalkorDB port | `6379` |
| `--include <patterns>` | Include glob patterns (comma-separated) | all supported extensions |
| `--exclude <patterns>` | Exclude glob patterns (comma-separated) | default ignore patterns |
| `--deep` | Enable deep analysis (call/render edges, complexity) | off |
| `--no-git` | Skip git history sync | syncs git |
| `--dry-run` | Parse without writing to database | off |

```
codegraph extract ./my-project
codegraph extract ./src --deep --include "**/*.ts,**/*.tsx"
codegraph extract ./my-project --dry-run
```

### `search` -- Search the code graph

```
codegraph search <query> [options]
```

Runs vector search with cross-encoder reranking.

| Option | Description | Default |
|--------|-------------|---------|
| `-l, --limit <n>` | Max results | `20` |
| `-s, --scope <path>` | Scope to path prefix | none |
| `--json` | Output as JSON | off |

```
codegraph search "authentication middleware"
codegraph search "parseProject" --limit 5 --json
```

### `status` -- Show graph database status and statistics

```
codegraph status [options]
```

Displays node/edge counts by type, largest files, and most connected entities.

| Option | Description | Default |
|--------|-------------|---------|
| `-g, --graph <name>` | Graph name | `codegraph` |
| `--json` | Output as JSON | off |

### `query` -- Execute a Cypher query against the graph

```
codegraph query <cypher> [options]
```

Runs a read-only Cypher query and outputs results in JSON, table, or CSV format.

| Option | Description | Default |
|--------|-------------|---------|
| `-g, --graph <name>` | Graph name | `codegraph` |
| `-h, --host <host>` | FalkorDB host | `localhost` |
| `-p, --port <port>` | FalkorDB port | `6379` |
| `--params <json>` | Query parameters as JSON | `{}` |
| `--format <type>` | Output format: `json`, `table`, `csv` | `json` |

```
codegraph query "MATCH (f:Function) RETURN f.name LIMIT 10"
codegraph query "MATCH (f:Function) WHERE f.name CONTAINS \$name RETURN f.name" --params '{"name":"parse"}'
codegraph query "MATCH (n) RETURN labels(n), count(*)" --format table
```

### `embed` -- Generate embeddings for graph nodes

```
codegraph embed [options]
```

Generates vector embeddings for nodes that don't have them yet (or all nodes with `--force`).

| Option | Description | Default |
|--------|-------------|---------|
| `-g, --graph <name>` | Graph name | `codegraph` |
| `-h, --host <host>` | FalkorDB host | `localhost` |
| `-p, --port <port>` | FalkorDB port | `6379` |
| `--force` | Re-embed all nodes | only missing |
| `--type <type>` | Only embed this node type (`File`, `Function`, `Class`, `Interface`, `Variable`, `Type`, `Component`) | all types |
| `--batch-size <size>` | Batch size | `100` |

```
codegraph embed
codegraph embed --force --type Function
```

### `analyze` -- Run analysis on the code graph

```
codegraph analyze <type> <target> [options]
```

Currently supports `deps` analysis type, which shows the dependency tree for a function or file.

| Option | Description | Default |
|--------|-------------|---------|
| `--depth <n>` | Analysis depth | `3` |
| `--json` | Output as JSON | off |

```
codegraph analyze deps parseProject --depth 5
```

### `map` -- Generate a repository map

```
codegraph map [path] [options]
```

Generates a tree-style repository map showing files and their contained entities.

| Option | Description | Default |
|--------|-------------|---------|
| `-l, --limit <n>` | Max nodes to include | `100` |
| `-o, --output <file>` | Output file (defaults to stdout) | stdout |
| `--json` | Output as JSON | off |

```
codegraph map
codegraph map packages/core/src --limit 50
codegraph map --json -o repo-map.json
```

### `link` -- Link knowledge entities to code graph nodes

```
codegraph link [options]
```

Creates ABOUT edges between knowledge graph entities and code graph nodes. Supports name matching (default) and embedding similarity modes.

| Option | Description | Default |
|--------|-------------|---------|
| `--embedding` | Use embedding similarity instead of name matching | name matching |
| `--threshold <number>` | Similarity threshold for embedding mode (0.0-1.0) | `0.8` |
| `--force` | Re-link all entities (ignore existing ABOUT edges) | off |

```
codegraph link
codegraph link --embedding --threshold 0.75
codegraph link --force
```

### `serve` -- Start the MCP server

```
codegraph serve [options]
```

Prints instructions for starting the MCP server via the `@codegraph/mcp-server` package.

| Option | Description | Default |
|--------|-------------|---------|
| `-g, --graph <name>` | Graph name | `codegraph` |
| `--db-host <host>` | FalkorDB host | `localhost` |
| `--db-port <port>` | FalkorDB port | `6379` |

## Global Options

| Option | Description |
|--------|-------------|
| `-v, --verbose` | Enable verbose logging |
| `-V, --version` | Show version |
| `--help` | Show help |

## Environment Variables

The CLI connects to FalkorDB and uses embedding/reranking providers configured via environment:

| Variable | Description |
|----------|-------------|
| `FALKORDB_HOST` | FalkorDB host (default: `localhost`) |
| `FALKORDB_PORT` | FalkorDB port (default: `6379`) |
| `FALKORDB_GRAPH` | Graph name (default: `codegraph`) |
| `VOYAGE_API_KEY` | API key for Voyage embeddings (auto-detects provider) |
| `OPENROUTER_API_KEY` | API key for OpenRouter embeddings (auto-detects provider) |
| `JINA_API_KEY` | API key for Jina reranker (auto-detects provider) |
| `CODEGRAPH_EMBEDDING_PROVIDER` | Optional override: `voyage`, `openrouter`, or `local` |
| `CODEGRAPH_RERANK_PROVIDER` | Optional override: `jina` or `voyage` |
| `LOG_LEVEL` | Log verbosity: `debug`, `info`, `warn`, `error` |

## Dependencies

- `@codegraph/core` -- indexing, search, graph client, service layer
- `@codegraph/logger` -- structured logging
- `@codegraph/plugin-nlp` -- entity linking (for `link` command)
- `@codegraph/types` -- shared type definitions
- `commander` -- CLI framework
