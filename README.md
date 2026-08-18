# CodeGraph

[![CI](https://github.com/Phoenixrr2113/codebase-graph/actions/workflows/ci.yml/badge.svg)](https://github.com/Phoenixrr2113/codebase-graph/actions/workflows/ci.yml)
[![CodeQL](https://github.com/Phoenixrr2113/codebase-graph/actions/workflows/codeql.yml/badge.svg)](https://github.com/Phoenixrr2113/codebase-graph/actions/workflows/codeql.yml)
[![GitHub stars](https://img.shields.io/github/stars/Phoenixrr2113/codebase-graph?style=flat)](https://github.com/Phoenixrr2113/codebase-graph/stargazers)
[![MIT license](https://img.shields.io/github/license/Phoenixrr2113/codebase-graph)](LICENSE)

CodeGraph turns source code and project knowledge into a searchable graph for AI agents. It parses code with tree-sitter, stores structural and temporal relationships in FalkorDB, and exposes four focused tools through the Model Context Protocol (MCP).

## Access the project

- [Live application](https://v0-landing-page-build-kappa-virid.vercel.app)
- [Source code](https://github.com/Phoenixrr2113/codebase-graph)
- [Issues](https://github.com/Phoenixrr2113/codebase-graph/issues)
- [Discussions](https://github.com/Phoenixrr2113/codebase-graph/discussions)
- [Contribution guide](CONTRIBUTING.md)
- [Security policy](SECURITY.md)
- [MIT license](LICENSE)

The public npm package is named `codegraph-mcp`. Its npm link, version badge, and weekly-download badge will be added after the one-time `0.1.0` bootstrap publish is verified against the registry.

## What it does

- Searches code by symbol, structure, and meaning.
- Extracts functions, classes, interfaces, variables, types, imports, calls, and other relationships.
- Stores project facts with `valid_at` and `invalid_at` timestamps for point-in-time queries.
- Supports first-class TypeScript, JavaScript, Python, Go, Rust, and Markdown parsing, with generic tree-sitter support for additional languages.
- Runs with embedded FalkorDBLite on Linux x64 and Apple silicon macOS, or an external FalkorDB service on any supported Node.js platform. Apple silicon requires Homebrew `libomp` and `openssl@3` runtime libraries.
- Exposes `search`, `knowledge`, `codebase`, and `query` MCP tools.

## Install from source

Requirements: Node.js 22, Corepack, and Docker for the external FalkorDB quickstart.

```bash
git clone https://github.com/Phoenixrr2113/codebase-graph.git
cd codebase-graph
corepack enable
pnpm install --frozen-lockfile
pnpm build
pnpm docker:db
```

Use `CODEGRAPH_EMBEDDING_PROVIDER=none` for structural search without an API key. Configure a supported embedding provider later if you want semantic vector search.

## Use with an MCP client

### Source checkout

After building the repository, point the client at the generated server entry point. Replace both absolute paths with paths on your machine.

```json
{
  "mcpServers": {
    "codegraph": {
      "command": "node",
      "args": [
        "/absolute/path/to/codebase-graph/packages/mcp-server/dist/index.js"
      ],
      "env": {
        "CODEGRAPH_EMBEDDING_PROVIDER": "none",
        "CODEGRAPH_DRIVER": "falkordb",
        "FALKORDB_HOST": "localhost",
        "FALKORDB_PORT": "6379"
      }
    }
  }
}
```

For Claude Code:

```bash
claude mcp add codegraph \
  --env CODEGRAPH_EMBEDDING_PROVIDER=none \
  --env CODEGRAPH_DRIVER=falkordb \
  --env FALKORDB_HOST=localhost \
  --env FALKORDB_PORT=6379 \
  -- node /absolute/path/to/codebase-graph/packages/mcp-server/dist/index.js
```

### npm package after bootstrap

After `codegraph-mcp@0.1.0` is visible on npm, clients can run the server without a source checkout:

```json
{
  "mcpServers": {
    "codegraph": {
      "command": "npx",
      "args": ["-y", "codegraph-mcp"],
      "env": {
        "CODEGRAPH_EMBEDDING_PROVIDER": "none"
      }
    }
  }
}
```

The first conversation can configure and index a project through the `codebase` tool:

```json
{ "action": "configure", "projectAction": "set", "projects": ["/absolute/path/to/project"] }
```

```json
{ "action": "reindex", "mode": "full" }
```

Embedded storage is selected automatically on Linux x64. On Apple silicon macOS, install its native runtime libraries first with `brew install libomp openssl@3`; CodeGraph otherwise falls back to external FalkorDB. Windows, Intel macOS, and Linux arm64 require an external FalkorDB service. Set `CODEGRAPH_DRIVER=falkordb`, `FALKORDB_HOST`, and `FALKORDB_PORT` in the MCP client environment on those platforms.

## MCP tools

| Tool | Purpose |
| --- | --- |
| `search` | Find code and project knowledge by name, structure, or meaning |
| `knowledge` | Store and recall entities, relationships, facts, and documents |
| `codebase` | Configure projects, index code, inspect status, and read source |
| `query` | Run read-only Cypher queries against the graph |

Set `CODEGRAPH_RAW_TOOLS=1` to expose the lower-level handlers instead of the four grouped tools.

## Configuration

| Variable | Purpose |
| --- | --- |
| `CODEGRAPH_DRIVER` | `falkordblite` for embedded storage or `falkordb` for an external service |
| `CODEGRAPH_DB_PATH` | Embedded FalkorDBLite data path |
| `FALKORDB_HOST` | External FalkorDB host, default `localhost` |
| `FALKORDB_PORT` | External FalkorDB port, default `6379` |
| `FALKORDB_GRAPH` | Graph name, default `codegraph` |
| `CODEGRAPH_EMBEDDING_PROVIDER` | `none`, `local`, `voyage`, or `openrouter` |
| `VOYAGE_API_KEY` | Voyage embeddings and optional reranking |
| `OPENROUTER_API_KEY` | OpenRouter embeddings or LLM features |
| `CEREBRAS_API_KEY` | Optional LLM-backed knowledge extraction |

Never commit provider keys. Put secrets in the MCP client's protected environment configuration or a local ignored `.env` file.

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
| [`@codegraph/mcp-server`](packages/mcp-server/) | MCP transport and the four public tool groups |
| [`@codegraph/cli`](packages/cli/) | Source-checkout command-line tools |
| [`codegraph-mcp`](packages/npm-package/) | Public npm distribution staging and entry point |
| [`@codegraph/mcpb`](packages/mcpb/) | Platform-local MCPB desktop extension build |

The Next.js application lives in [`apps/web`](apps/web/), and the reproducible search benchmark lives in [`benchmarks/cgbench-v1`](benchmarks/cgbench-v1/).

## License

CodeGraph is available under the [MIT License](LICENSE).
