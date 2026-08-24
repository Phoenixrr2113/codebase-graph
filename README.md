# CodeGraph

[![CI](https://github.com/Phoenixrr2113/codebase-graph/actions/workflows/ci.yml/badge.svg)](https://github.com/Phoenixrr2113/codebase-graph/actions/workflows/ci.yml)
[![CodeQL](https://github.com/Phoenixrr2113/codebase-graph/actions/workflows/codeql.yml/badge.svg)](https://github.com/Phoenixrr2113/codebase-graph/actions/workflows/codeql.yml)
[![GitHub stars](https://img.shields.io/github/stars/Phoenixrr2113/codebase-graph?style=flat)](https://github.com/Phoenixrr2113/codebase-graph/stargazers)
[![MIT license](https://img.shields.io/github/license/Phoenixrr2113/codebase-graph)](LICENSE)

CodeGraph turns source code and project knowledge into a searchable graph for AI agents and developers. It parses code with tree-sitter, stores structural and temporal relationships in FalkorDB, and exposes five focused tools through the Model Context Protocol (MCP).

## Access the project

- [Landing page](https://v0-landing-page-build-kappa-virid.vercel.app)
- [Source code](https://github.com/Phoenixrr2113/codebase-graph)
- [Issues](https://github.com/Phoenixrr2113/codebase-graph/issues)
- [Discussions](https://github.com/Phoenixrr2113/codebase-graph/discussions)
- [Contribution guide](CONTRIBUTING.md)
- [Security policy](SECURITY.md)
- [MIT license](LICENSE)

The public npm package is named `@codegraph/mcp`. Its npm link, version badge, and weekly-download badge will be added after the one-time `0.1.0` bootstrap publish is verified against the registry.

## What it does

- Searches code by symbol, structure, and meaning.
- Extracts functions, classes, interfaces, variables, types, imports, calls, and other relationships.
- Stores project facts with `valid_at` and `invalid_at` timestamps for point-in-time queries.
- Supports first-class TypeScript, JavaScript, Python, Go, Rust, and Markdown parsing, with generic tree-sitter support for additional languages.
- Runs with embedded FalkorDBLite on Linux x64 and Apple silicon macOS, or an external FalkorDB service on any supported Node.js platform. Apple silicon requires Homebrew `libomp` and `openssl@3` runtime libraries.
- Explores exact graph totals in Files or Symbols view with most-connected-first windows, Previous/Next paging, append-style loading, in-place neighbor expansion, and a Files-view toggle for unresolved external modules.
- Exposes `analyze`, `codebase`, `knowledge`, `query`, and `search` MCP tools.

## Choose how to start

CodeGraph requires Node.js 20 or newer. The npm commands below apply after `@codegraph/mcp` is visible in the npm registry.

### Agent-first with MCP

Add this server configuration to an MCP client:

```json
{
  "mcpServers": {
    "codegraph": {
      "command": "npx",
      "args": ["-y", "-p", "@codegraph/mcp", "codegraph-mcp"]
    }
  }
}
```

In the first conversation, ask the agent to check CodeGraph status:

```json
{"method":"tools/call","params":{"name":"codebase","arguments":{"action":"status"}}}
```

On a fresh install, `codebase` status returns `configured: false` and `setupRequired: true`. An empty database is a valid first run. Configure one absolute project path, then start a full index:

```json
{"method":"tools/call","params":{"name":"codebase","arguments":{"action":"configure","projectAction":"set","projects":["/absolute/path/to/project"]}}}
```

```json
{"method":"tools/call","params":{"name":"codebase","arguments":{"action":"reindex","mode":"full","scope":"/absolute/path/to/project"}}}
```

Configuration saves the project but does not index it. The full reindex parses structure first and then finishes embeddings. With the local provider, `codebase` status includes model load and indexing state while work is running.

### Dashboard-first in a browser

Start the dashboard directly from the package:

```bash
npx -y -p @codegraph/mcp codegraph-dashboard
```

Open the URL printed by the process. A fresh database opens on the setup flow. Confirm storage and embeddings, choose Browse to select a folder, then select Index project. The page shows model download and indexing progress, finishes remaining embeddings automatically, and reports file, symbol, edge, and embedding counts before opening the graph explorer.

The dashboard and MCP server are separate entry points. They can run at the same time against the same data path.

## Platform and storage

| Platform | Default driver | Prerequisites | Configuration |
| --- | --- | --- | --- |
| Linux x64 | Embedded FalkorDBLite | Node.js 20 or newer | No database configuration when the embedded package is available |
| macOS Apple silicon | Embedded FalkorDBLite | Node.js 20 or newer, `brew install libomp openssl@3` | No database configuration when the libraries and embedded package are available |
| macOS Intel | External FalkorDB | Node.js 20 or newer | Set the external variables below |
| Windows x64 | External FalkorDB | Node.js 20 or newer | Set the external variables below |
| Linux arm64 and other platforms | External FalkorDB | Node.js 20 or newer | Set the external variables below |

An explicit `CODEGRAPH_DRIVER` always wins. Without it, a configured `FALKORDB_URL` or `FALKORDB_HOST` selects external FalkorDB. Otherwise CodeGraph selects embedded FalkorDBLite on Linux x64, or on Apple silicon macOS when its native libraries are present, and falls back to external FalkorDB if the embedded package cannot load. All other platforms default to external FalkorDB.

`CODEGRAPH_DATA_DIR` defaults to `~/.codegraph`; the MCP project configuration is stored at `~/.codegraph/mcp-context.json`. Embedded database storage separately defaults to `<current working directory>/.codegraph/falkordb`. If that database path is too long for a Unix socket, CodeGraph relocates it to `~/.codegraph/graphs/<12-hex-digest>`. Set `CODEGRAPH_DATA_DIR` to a writable directory for MCP configuration, and set `CODEGRAPH_DB_PATH` to a writable directory for embedded database files.

For external FalkorDB, set either a URL:

```text
CODEGRAPH_DRIVER=falkordb
FALKORDB_URL=host:6379
```

Or set a host and port:

```text
CODEGRAPH_DRIVER=falkordb
FALKORDB_HOST=host
FALKORDB_PORT=6379
```

One database server runs per data directory; a second CodeGraph process attaches to it.

## Embeddings and privacy

| Provider | Model and dimensions | Configuration | First run |
| --- | --- | --- | --- |
| Local | `nomic-ai/nomic-embed-text-v1.5`, 768 | No key and no provider override | Default no-key path. Downloads approximately 132 MiB, measured as 138,011,417 bytes (131.6 MiB), shows progress, then caches the model locally. |
| Voyage | `voyage-code-3`, 1024 | `CODEGRAPH_EMBEDDING_PROVIDER=voyage` and `VOYAGE_API_KEY` | Sends embedding inputs to Voyage. |
| OpenRouter | `openai/text-embedding-3-small`, 1536 | `CODEGRAPH_EMBEDDING_PROVIDER=openrouter` and `OPENROUTER_API_KEY` | Sends embedding inputs to OpenRouter. |
| None | No model, 0 | `CODEGRAPH_EMBEDDING_PROVIDER=none` | Explicit structural-only mode. Semantic similarity search is unavailable. |

If no provider is set, a configured Voyage key selects Voyage, a configured OpenRouter key selects OpenRouter, and no key selects local. Set `CODEGRAPH_EMBEDDING_PROVIDER` explicitly when you need to pin the choice.

Provider, model, and dimension are stored with the graph. If any of them changes, CodeGraph blocks graph mutation with this remedy: `Run an explicit re-embed migration or a full reindex before using the requested embedding profile.`

## MCP tools

| Tool | Purpose |
| --- | --- |
| `analyze` | Inspect impact, call hierarchy, cycles, dead-code candidates, hotspots, change coupling, and ownership inferred from indexed git history |
| `search` | Find code and project knowledge by name, structure, or meaning |
| `knowledge` | Store and recall entities, relationships, facts, and documents |
| `codebase` | Configure projects, index code, inspect status, and read source |
| `query` | Run read-only Cypher queries against the graph |

Set `CODEGRAPH_RAW_TOOLS=true` to expose lower-level handlers alongside the five grouped tools.

## Configuration

| Variable | Purpose |
| --- | --- |
| `CODEGRAPH_DRIVER` | `falkordblite` for embedded storage or `falkordb` for an external service; defaults by platform as described above |
| `CODEGRAPH_DATA_DIR` | MCP configuration directory, default `~/.codegraph`; must be writable by the CodeGraph process |
| `CODEGRAPH_DB_PATH` | Embedded FalkorDBLite data path, default `<current working directory>/.codegraph/falkordb`; must be writable by the CodeGraph process |
| `FALKORDB_URL` | External FalkorDB host and port |
| `FALKORDB_HOST` | External FalkorDB host, default `localhost` |
| `FALKORDB_PORT` | External FalkorDB port, default `6379` |
| `FALKORDB_GRAPH` | Graph name, default `codegraph` |
| `CODEGRAPH_EMBEDDING_PROVIDER` | `local`, `voyage`, `openrouter`, or `none`; when unset, resolves Voyage key, then OpenRouter key, then local |
| `VOYAGE_API_KEY` | Voyage embeddings and optional reranking |
| `OPENROUTER_API_KEY` | OpenRouter embeddings or LLM features |
| `CEREBRAS_API_KEY` | Optional LLM-backed knowledge extraction |
| `API_PORT` | Dashboard and REST API port, default `3001`; use the printed URL |
| `CODEGRAPH_BROWSE_ROOTS` | Additional absolute dashboard Browse roots, separated by commas |
| `CODEGRAPH_RAW_TOOLS` | Set to the literal value `true` to expose raw handlers alongside the five grouped MCP tools |

Never commit provider keys. Put secrets in the MCP client's protected environment configuration or a local ignored `.env` file.

## Release verification

The canonical package command is:

```bash
pnpm pack:npm
```

It builds and validates one publishable tarball under `tmp/release`. The complete release gate is:

```bash
pnpm release:check
```

The basic installed-tarball smoke proves the package installs in a clean consumer, both binaries start, all five MCP tools are present, a fresh database is setup-safe, Browse and indexing work, data survives restarts, the dashboard and MCP process share one embedded server, and the exact tarball hash is reported. The release CI runs that installed artifact with embedded storage on Linux x64 and Apple silicon, and checks external FalkorDB guidance on Windows x64. An opt-in local-provider lane proves cold model download progress and a usable 768-dimension vector index.

A local tarball cannot prove npm registry resolution. Verify `npx -y -p @codegraph/mcp codegraph-mcp` and `npx -y -p @codegraph/mcp codegraph-dashboard` only after publication.

## Development

```bash
pnpm install --frozen-lockfile
pnpm audit:prod
pnpm lint
pnpm typecheck
pnpm test
pnpm build
pnpm docker:db
pnpm test:integration
pnpm test:scripts
pnpm build:mcpb
pnpm release:check
```

See [CONTRIBUTING.md](CONTRIBUTING.md) for the pull request workflow and required evidence.
FalkorDBLite's Linux x64 and Apple silicon macOS binaries are installed with the workspace dependencies. Apple silicon also requires Homebrew `libomp` and `openssl@3`.

## Packages

| Package | Responsibility |
| --- | --- |
| [`@codegraph/core`](packages/core/) | Indexing, search pipelines, services, and git synchronization |
| [`@codegraph/graph`](packages/graph/) | FalkorDB and FalkorDBLite drivers, graph queries, and knowledge operations |
| [`@codegraph/plugin-nlp`](packages/plugin-nlp/) | Embeddings, reranking, entity resolution, and document ingestion |
| [`@codegraph/mcp-server`](packages/mcp-server/) | MCP transport and the five public tool groups |
| [`@codegraph/cli`](packages/cli/) | Source-checkout command-line tools |
| [`@codegraph/mcp`](packages/npm-package/) | Public npm distribution staging and entry point |
| [`@codegraph/mcpb`](packages/mcpb/) | Platform-local MCPB desktop extension build |
| [`@codegraph/api`](packages/api/) | REST API consumed by the dashboard |
| [`@codegraph/dashboard`](packages/dashboard/) | Static dashboard UI served by the API |

The marketing site lives in [`apps/web`](apps/web/), and the reproducible search benchmark lives in [`benchmarks/cgbench-v1`](benchmarks/cgbench-v1/).

## License

CodeGraph is available under the [MIT License](LICENSE).
