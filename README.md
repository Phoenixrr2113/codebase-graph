# CodeGraph

**Understand your codebase at a glance.** CodeGraph parses your source code, builds a knowledge graph of every function, class, and relationship, then lets you explore, analyze, and query it through AI assistants.

![FalkorDB](https://img.shields.io/badge/FalkorDB-Graph%20Database-blue)
![FalkorDBLite](https://img.shields.io/badge/FalkorDBLite-Embedded-blue)
![TypeScript](https://img.shields.io/badge/TypeScript-5.7-blue)
![Languages](https://img.shields.io/badge/Languages-42-green)
![MCP](https://img.shields.io/badge/MCP-4%20Persona%20Tools-green)
![Tests](https://img.shields.io/badge/Tests-Passing-brightgreen)
![License](https://img.shields.io/badge/License-MIT-yellow)

## The Problem

Modern codebases are complex. When you need to:
- **Understand impact** — "What breaks if I change this function?"
- **Find security issues** — "Where is user input flowing to SQL queries?"
- **Reduce complexity** — "Which functions are too complex and need refactoring?"
- **Navigate relationships** — "What calls this? What does this depend on?"

...you're usually stuck grep'ing through files, hoping you didn't miss something.

## The Solution

CodeGraph builds a **queryable knowledge graph** of your entire codebase:

```
Your Codebase  →  Tree-sitter Parser  →  FalkorDB Graph  →  Insights

  42 languages        Functions, Classes, Components, Interfaces, Types
  74 file extensions  CALLS, IMPORTS, EXTENDS, IMPLEMENTS, RENDERS edges
                      Complexity metrics per function
                      Knowledge graph with temporal memory
                      Vector search + cross-encoder reranking
                      Git history integration
```

## Quick Start

### Option A: FalkorDBLite (Embedded, No Docker)

The fastest way to get started. FalkorDBLite runs an embedded database with zero external infrastructure:

```bash
# Prerequisites: redis-server (macOS arm64 or Linux x64)
brew install redis  # macOS

# Clone and install
git clone https://github.com/your-org/codegraph.git
cd codegraph && pnpm install && pnpm build

# Extract your codebase
pnpm codegraph extract ./src

# Search your codebase
pnpm codegraph search "auth"
```

A `.codegraph/config.json` file is created automatically:

```json
{
  "driver": "falkordblite",
  "databasePath": ".codegraph/falkordb",
  "graphName": "codegraph"
}
```

### Option B: FalkorDB (Docker)

For development or team/enterprise deployments with a shared graph server:

```bash
# Clone and install
git clone https://github.com/your-org/codegraph.git
cd codegraph && pnpm install && pnpm build

# Start FalkorDB via Docker
pnpm docker:db

# Extract your codebase
pnpm codegraph extract ./src

# Search your codebase
pnpm codegraph search "auth"
```

## Usage with AI Assistants (MCP)

CodeGraph provides 4 persona-based MCP tools for AI assistants.

### Claude Desktop

Add to `~/Library/Application Support/Claude/claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "codegraph": {
      "command": "node",
      "args": ["/path/to/codebase-graph/packages/mcp-server/dist/index.js"],
      "env": {
        "VOYAGE_API_KEY": "your-key",
        "JINA_API_KEY": "your-key"
      }
    }
  }
}
```

### Claude Code

Add to `.claude/settings.json` or run:

```bash
claude mcp add codegraph node /path/to/codebase-graph/packages/mcp-server/dist/index.js
```

### Persona Tools

| Tool | What it does |
|------|-------------|
| **search** | Find code and symbols by name or meaning, get context for files and symbols |
| **knowledge** | Store and recall domain knowledge — entities, relationships, facts, conversations |
| **codebase** | Configure projects, reindex, check status/stats, read source code |
| **query** | Execute Cypher queries against the graph (read-only, validated) |

Then ask your AI assistant:
> "How does the auth flow work?"

The `search` tool uses vector similarity (Voyage code-3) and cross-encoder reranking (Jina reranker-v3) to find relevant code.

Raw tools are available via `CODEGRAPH_RAW_TOOLS=1` for power users.

## Search

CodeGraph uses a single high-quality search pipeline:

- **Vector retrieval**: Voyage code-3 embeddings → FalkorDB HNSW index
- **Cross-encoder reranking**: Jina reranker-v3 for precision ranking
- **Graph enrichment**: Callers, callees, importers added to results

Benchmark: MRR 0.944, Success@1 90%, Success@5 100%, ~400ms latency.

## What Gets Extracted

### Tier 1 — Full extraction (8 languages)

| Language | Entities | Relationships |
|----------|----------|---------------|
| TypeScript/JavaScript | Functions, Classes, Interfaces, Types, Components | CALLS, IMPORTS, RENDERS, EXTENDS, IMPLEMENTS |
| Python | Functions, Classes, Variables | CALLS, IMPORTS, EXTENDS |
| C# | Classes, Interfaces, Methods | CALLS, EXTENDS, IMPLEMENTS |
| Go | Functions, Structs, Interfaces | CALLS, IMPORTS, IMPLEMENTS |
| Java | Classes, Interfaces, Methods | CALLS, EXTENDS, IMPLEMENTS |
| Rust | Functions, Structs, Traits, Impls | CALLS, IMPORTS, IMPLEMENTS |
| PHP | Functions, Classes, Interfaces | CALLS, EXTENDS, IMPLEMENTS |
| Markdown | Documents, Sections, Links | LINKS_TO, REFERENCES |

### Tier 2 — Config-driven extraction (34 languages)

Ruby, Kotlin, Swift, Scala, Dart, C, C++, Objective-C, Lua, Elixir, Erlang, R, Haskell, Perl, Julia, Clojure, Bash, PowerShell, SQL, HCL/Terraform, YAML, TOML, HTML, CSS, JSON, Dockerfile, OCaml, F#, Zig, Nim, Crystal, Groovy, Verilog, Protobuf

Tier 2 languages use the generic plugin system with declarative configs. They extract functions, classes, imports, and variables using tree-sitter grammars (installed as optional dependencies).

### Additional Capabilities

- **Complexity** — Cyclomatic, cognitive, nesting depth
- **Git History** — Commits linked to code changes
- **Knowledge Graph** — Entity/relationship extraction with temporal memory
- **Embeddings** — Local (nomic-embed-text-v1.5, 768-dim) + cloud (Voyage code-3)

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    MCP Server (stdio)                        │
│         4 persona tools  •  raw tools available             │
└───────────────────────────────────────────────────────────┬─┘
                                                            │
┌───────────────────────────────────────────────────────────┴─┐
│                    Core Service Layer                        │
│   Indexer  •  Search (enrichedSearchV2)  •  File Watcher   │
│   Parser Pipeline  •  Git Sync  •  Config Management       │
└───────────────────────────────────────────────────────────┬─┘
                                                            │
┌──────────────────────────┐  ┌─────────────────────────────┴─┐
│     NLP Pipeline         │  │    Graph Database              │
│  Entity Extraction       │  │  ┌──────────┐  ┌───────────┐  │
│  Embeddings (3 tiers)    │  │  │ FalkorDB │  │FalkorDBLite│  │
│  Reranker (Jina/Voyage)  │  │  │ (Docker) │  │(Embedded) │  │
│  Bridge Linking          │  │  └──────────┘  └───────────┘  │
│  Conversation Ingestion  │  │  Nodes: File, Function, Class │
└──────────────────────────┘  │  Edges: CALLS, IMPORTS, ...   │
                              │  Vector: HNSW on all types    │
┌──────────────────────────┐  └───────────────────────────────┘
│     CLI (codegraph)      │
│  extract • search • serve│
│  status • query • embed  │
└──────────────────────────┘
```

## Packages

| Package | Description |
|---------|-------------|
| [`@codegraph/core`](packages/core/) | Main orchestrator — parsing, indexing, search, embedding, service layer |
| [`@codegraph/graph`](packages/graph/) | Driver-agnostic graph database client (FalkorDB, FalkorDBLite) |
| [`@codegraph/plugin-nlp`](packages/plugin-nlp/) | NLP pipeline — embeddings, reranking, entity extraction, knowledge graph |
| [`@codegraph/mcp-server`](packages/mcp-server/) | MCP server — 4 persona tools for AI assistants |
| [`@codegraph/cli`](packages/cli/) | CLI for extracting, searching, and querying code graphs |
| [`@codegraph/logger`](packages/logger/) | Structured logging with namespace support and stderr mode |
| [`@codegraph/types`](packages/types/) | Shared TypeScript type definitions for all packages |
| [`@codegraph/plugin-typescript`](packages/plugin-typescript/) | TypeScript/JavaScript/JSX language plugin |
| [`@codegraph/plugin-python`](packages/plugin-python/) | Python language plugin |
| [`@codegraph/plugin-go`](packages/plugin-go/) | Go language plugin |
| [`@codegraph/plugin-rust`](packages/plugin-rust/) | Rust language plugin |
| [`@codegraph/plugin-markdown`](packages/plugin-markdown/) | Markdown document parser (sections, code blocks, links) |
| [`@codegraph/plugin-generic`](packages/plugin-generic/) | Config-driven language plugin factory |
| [`@codegraph/plugin-common`](packages/plugin-common/) | Shared plugin utilities — complexity metrics, AST helpers |
| [`@codegraph/plugin-languages`](packages/plugin-languages/) | 34 tier-2 language configs with lazy grammar loading |

## Configuration

### Config File (Recommended)

Create `.codegraph/config.json` in your project root:

```json
{
  "driver": "falkordblite",
  "databasePath": ".codegraph/falkordb",
  "graphName": "codegraph"
}
```

The config file is automatically discovered by searching the current directory and up to 5 parent directories. Relative paths in `databasePath` are resolved against the directory containing the config file.

### Environment Variables

```env
# Driver selection (falkordb | falkordblite)
CODEGRAPH_DRIVER=falkordb

# FalkorDB connection (when using falkordb driver)
FALKORDB_URL=your-instance.cloud:port
FALKORDB_USERNAME=falkordb
FALKORDB_PASSWORD=your-password
FALKORDB_HOST=localhost
FALKORDB_PORT=6379
FALKORDB_GRAPH=codegraph

# FalkorDBLite (when using falkordblite driver)
CODEGRAPH_DB_PATH=.codegraph/falkordb

# Embeddings
CODEGRAPH_EMBEDDING_PROVIDER=voyage    # voyage | local
VOYAGE_API_KEY=your-key

# Reranking
CODEGRAPH_RERANK_PROVIDER=jina         # jina | voyage
JINA_API_KEY=your-key

# LLM (for knowledge extraction)
OPENROUTER_API_KEY=your-key            # OpenRouter

# MCP persona mode (default) vs raw tools
CODEGRAPH_RAW_TOOLS=1                  # Set to expose individual tools
```

### Auto-Detection Priority

```
Explicit arguments > .codegraph/config.json > Environment variables > Default (falkordb)
```

## Database Options

| Mode | Driver | Use Case | Requirements |
|------|--------|----------|-------------|
| **Local** | `falkordblite` | Single-user, no Docker | `redis-server`, macOS arm64 or Linux x64 |
| **Development** | `falkordb` | Development, testing | Docker |
| **Team/Enterprise** | `falkordb` | Multi-user, shared graphs | FalkorDB Cloud or self-hosted |

## Development

```bash
pnpm install        # Install dependencies
pnpm build          # Build all packages
pnpm dev            # Start dev mode
pnpm test           # Run all tests
pnpm docker:db      # Start FalkorDB via Docker
pnpm docker:reset   # Reset FalkorDB (wipe data)
```

## Tech Stack

- **Parsing**: Tree-sitter — 42 languages (8 tier-1 + 34 tier-2)
- **Graph DB**: FalkorDB (Docker/Cloud) or FalkorDBLite (embedded)
- **Search**: Voyage code-3 embeddings + Jina reranker-v3 (MRR 0.944)
- **Embeddings**: Local (nomic-embed-text-v1.5, 768-dim) + Cloud (Voyage code-3)
- **LLM**: Vercel AI SDK v6, multi-provider (OpenRouter, Ollama)
- **Build**: Turborepo, pnpm workspaces, TypeScript 5.7, ESM
- **Testing**: Vitest, Playwright (e2e)
- **MCP**: Model Context Protocol SDK for AI assistant integration

## Roadmap

See [ROADMAP.md](ROADMAP.md) for detailed status.

**Current focus:** Commercial distribution — binary compilation, licensing, landing page, documentation site.

---

## License

MIT
