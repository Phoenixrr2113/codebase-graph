# @codegraph/cli

Internal command-line interface for working from a CodeGraph source checkout. This workspace package is not published by the repository release workflow.

## Build and inspect

From the repository root:

```bash
pnpm --filter @codegraph/cli build
pnpm --filter @codegraph/cli exec tsx src/index.ts --help
```

The package manifest defines both `codegraph` and `cg` as aliases for `dist/index.js` inside the workspace.

## Commands

### `extract <path>`

Parse source files and populate the graph. Git history sync is enabled unless `--no-git` is supplied.

| Option | Meaning | Default |
| --- | --- | --- |
| `-g, --graph <name>` | Graph name | `codegraph` |
| `-h, --host <host>` | FalkorDB host | `localhost` |
| `-p, --port <port>` | FalkorDB port | `6379` |
| `--include <patterns>` | Comma-separated include globs | Supported extensions |
| `--exclude <patterns>` | Comma-separated exclude globs | Core ignore patterns |
| `--deep` | Extract call/render edges and complexity | Off |
| `--no-git` | Skip git history sync | Git sync on |
| `--history-since <iso>` | Inclusive ISO 8601 cutoff for persisted history | 365 days before initial sync |
| `--history-max-commits <count>` | Initial-backfill ceiling from 1 through 100000 | `10000` |
| `--dry-run` | Parse without graph writes | Off |

History dates use strict ISO calendar validation. Persisted history bounds widen but do not narrow on later indexing runs.

### `search <query>`

Search indexed code. Vector retrieval uses the resolved embedding provider; reranking is optional.

| Option | Meaning | Default |
| --- | --- | --- |
| `-l, --limit <n>` | Maximum results | `20` |
| `-s, --scope <path>` | Path-prefix scope | None |
| `--json` | JSON output | Off |

### `status`

Show graph statistics.

| Option | Meaning | Default |
| --- | --- | --- |
| `-g, --graph <name>` | Graph name | `codegraph` |
| `--json` | JSON output | Off |

### `query <cypher>`

Execute read-only Cypher.

| Option | Meaning | Default |
| --- | --- | --- |
| `-g, --graph <name>` | Graph name | `codegraph` |
| `-h, --host <host>` | FalkorDB host | `localhost` |
| `-p, --port <port>` | FalkorDB port | `6379` |
| `--params <json>` | Query parameters | None |
| `--format <type>` | `json`, `table`, or `csv` | `json` |

### `embed`

Generate missing embeddings or refresh selected node types.

| Option | Meaning | Default |
| --- | --- | --- |
| `-g, --graph <name>` | Graph name | `codegraph` |
| `-h, --host <host>` | FalkorDB host | `localhost` |
| `-p, --port <port>` | FalkorDB port | `6379` |
| `--force` | Re-embed all selected nodes | Missing embeddings only |
| `--type <type>` | `File`, `Function`, `Class`, `Interface`, `Variable`, `Type`, or `Component` | All supported types |
| `--batch-size <size>` | Embedding batch size | `100` |

### `analyze <type> <target>`

The CLI analysis command currently accepts the `deps` type.

| Option | Meaning | Default |
| --- | --- | --- |
| `-g, --graph <name>` | Graph name | `codegraph` |
| `-h, --host <host>` | FalkorDB host | `localhost` |
| `-p, --port <port>` | FalkorDB port | `6379` |
| `--depth <n>` | Dependency depth | `3` |
| `--json` | JSON output | Off |

### `map [path]`

Generate a repository map.

| Option | Meaning | Default |
| --- | --- | --- |
| `-g, --graph <name>` | Graph name | `codegraph` |
| `-h, --host <host>` | FalkorDB host | `localhost` |
| `-p, --port <port>` | FalkorDB port | `6379` |
| `-l, --limit <n>` | Maximum nodes | `100` |
| `-o, --output <file>` | Output file | Standard output |
| `--json` | JSON output | Off |

### `link`

Create `ABOUT` edges by name matching or embedding similarity.

| Option | Meaning | Default |
| --- | --- | --- |
| `-g, --graph <name>` | Graph name | `codegraph` |
| `-h, --host <host>` | FalkorDB host | `localhost` |
| `-p, --port <port>` | FalkorDB port | `6379` |
| `--embedding` | Use embedding similarity | Name matching |
| `--threshold <number>` | Similarity threshold from 0 through 1 | `0.8` |
| `--force` | Re-link existing entities | Off |

### `serve`

Print MCP server startup guidance.

| Option | Meaning | Default |
| --- | --- | --- |
| `-g, --graph <name>` | Graph name | `codegraph` |
| `--db-host <host>` | FalkorDB host | `localhost` |
| `--db-port <port>` | FalkorDB port | `6379` |

## Provider configuration

Embedding provider resolution is explicit configuration, then `CODEGRAPH_EMBEDDING_PROVIDER`, then `VOYAGE_API_KEY`, then `OPENROUTER_API_KEY`, then local. Valid explicit values are `local`, `voyage`, `openrouter`, and `none`. Voyage reranking is optional; without a supported key, search keeps fallback scores. Jina is not supported.
