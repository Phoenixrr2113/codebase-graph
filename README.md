# CodeGraph

**Understand your codebase at a glance.** CodeGraph parses your source code, builds a knowledge graph of every function, class, and relationship, then lets you explore, analyze, and query it — visually or through AI assistants.

![FalkorDB](https://img.shields.io/badge/FalkorDB-Graph%20Database-blue)
![FalkorDBLite](https://img.shields.io/badge/FalkorDBLite-Embedded-blue)
![TypeScript](https://img.shields.io/badge/TypeScript-5.7-blue)
![Languages](https://img.shields.io/badge/Languages-42-green)
![MCP](https://img.shields.io/badge/MCP-4%20Persona%20Tools-green)
![Tests](https://img.shields.io/badge/Tests-1320%20Passing-brightgreen)
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
                      Complexity metrics, security vulnerabilities
                      Knowledge graph with temporal memory
                      Hybrid search (vector + text + graph traversal)
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
cd codegraph && pnpm install

# Start FalkorDB via Docker
pnpm docker:db

# Start everything (API + Web)
pnpm start
```

Open [http://localhost:3000](http://localhost:3000), add a project, and start exploring.

## Usage with AI Assistants (MCP)

CodeGraph provides 4 persona-based MCP tools that consolidate underlying capabilities into a simple interface for AI assistants:

```json
{
  "codegraph": {
    "command": "node",
    "args": ["./packages/mcp-server/dist/index.js"]
  }
}
```

### Persona Tools

| Tool | What it does |
|------|-------------|
| **search** | Find code, symbols, ask questions — routes to the best search strategy automatically |
| **knowledge** | Store and recall domain knowledge — entities, relationships, facts, conversations |
| **codebase** | Index status, project structure, source code, file trees |
| **query** | Execute Cypher queries against the graph (read-only, validated) |

Then ask your AI assistant:
> "How does the auth flow work?"

The `search` tool combines vector similarity, text matching, and graph traversal to find relevant code and synthesize an answer.

Raw tools are available via `CODEGRAPH_RAW_TOOLS=1` for power users.

## Search Strategies

CodeGraph supports 2 search strategies:

| Strategy | Description |
|----------|-------------|
| `HYBRID` | Combined vector + text + graph traversal with RRF fusion |
| `ENRICHED_V2` | Vector retrieval + cross-encoder reranking (primary) |

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
- **Embeddings** — Local (nomic-embed-text-v1.5, 768-dim) + cloud (OpenRouter)

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                      Frontend (Next.js 16)                  │
│     Interactive Graph  •  Entity Detail  •  Source Preview  │
└───────────────────────────────────────────────────────────┬─┘
                                                            │ REST + WebSocket
┌───────────────────────────────────────────────────────────┴─┐
│                      API (Hono)                             │
│   Parse Service  •  Search Engine  •  File Watcher         │
└───────────────────────────────────────────────────────────┬─┘
                                                            │
┌───────────────────────────────────────────────────────────┴─┐
│              Graph Database (Driver Abstraction)            │
│   ┌──────────────────┐  ┌──────────────────┐               │
│   │ FalkorDB (Docker) │  │ FalkorDBLite     │               │
│   │ Team / Enterprise │  │ Local / Embedded │               │
│   └──────────────────┘  └──────────────────┘               │
│   Nodes: File, Function, Class, Component, Entity, Commit  │
│   Edges: CALLS, IMPORTS, EXTENDS, RENDERS, RELATES_TO      │
│   Vector: HNSW indexes on all node types + RELATES_TO       │
└─────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────┐
│                    MCP Server (stdio)                        │
│         4 persona tools  •  raw tools available             │
└─────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────┐
│                    NLP Pipeline                              │
│   Entity Extraction  •  Embeddings  •  Bridge Linking       │
│   Conversation Ingestion  •  Entity Resolution              │
│   Local: nomic-embed-text-v1.5  •  Cloud: OpenRouter        │
└─────────────────────────────────────────────────────────────┘
```

## Packages

| Package | Description |
|---------|-------------|
| [`@codegraph/core`](packages/core/) | Main orchestrator — parsing, analysis, search, embedding, service layer |
| [`@codegraph/graph`](packages/graph/) | Driver-agnostic graph database client (FalkorDB, FalkorDBLite) |
| [`@codegraph/plugin-nlp`](packages/plugin-nlp/) | NLP extraction, embeddings, knowledge graph operations |
| [`@codegraph/mcp-server`](packages/mcp-server/) | MCP server — 5 persona tools for AI assistants |
| [`@codegraph/api`](packages/api/) | REST API + WebSocket server (Hono) |
| [`@codegraph/cli`](packages/cli/) | CLI for extracting and querying code graphs |
| [`@codegraph/web`](packages/web/) | Next.js 16 frontend with interactive graph visualization |
| [`@codegraph/logger`](packages/logger/) | Centralized structured logging with OpenTelemetry tracing |
| [`@codegraph/types`](packages/types/) | Shared TypeScript types |
| [`@codegraph/plugin-generic`](packages/plugin-generic/) | Generic language plugin factory (`createLanguagePlugin()`) |
| [`@codegraph/plugin-common`](packages/plugin-common/) | Shared plugin utilities (language registry, extension maps) |
| [`@codegraph/plugin-languages`](packages/plugin-languages/) | 34 tier-2 language configs with lazy grammar loading |
| `@codegraph/plugin-typescript` | TypeScript/JavaScript language extractor |
| `@codegraph/plugin-python` | Python language extractor |
| `@codegraph/plugin-csharp` | C# language extractor |
| `@codegraph/plugin-go` | Go language extractor |
| `@codegraph/plugin-java` | Java language extractor |
| `@codegraph/plugin-rust` | Rust language extractor |
| `@codegraph/plugin-php` | PHP language extractor |
| `@codegraph/plugin-markdown` | Markdown document extractor |

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

# LLM (for AI-powered search and knowledge extraction)
OPENROUTER_API_KEY=your-key    # OpenRouter (recommended)
CEREBRAS_API_KEY=your-key      # Cerebras (fastest, used for search routing)

# MCP persona mode (default) vs raw tools
CODEGRAPH_RAW_TOOLS=1          # Set to expose 28 individual tools instead of 5 personas
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
pnpm build          # Build all 21 packages
pnpm dev            # Start dev servers (API:3001, Web:3000)
pnpm test           # Run all 1,320 tests
pnpm docker:db      # Start FalkorDB via Docker
pnpm docker:reset   # Reset FalkorDB (wipe data)
```

## Tech Stack

- **Frontend**: Next.js 16, React 19, Cytoscape.js, Tailwind CSS 4
- **API**: Hono, WebSocket, Node.js
- **Parsing**: Tree-sitter — 42 languages (8 tier-1 + 34 tier-2)
- **Graph DB**: FalkorDB (Docker) or FalkorDBLite (embedded)
- **Embeddings**: Local (nomic-embed-text-v1.5) + Cloud (OpenRouter)
- **LLM**: Vercel AI SDK v6, multi-provider (OpenRouter, Cerebras, Ollama)
- **Build**: Turborepo, pnpm workspaces, ESM
- **Testing**: Vitest (62 test files, 1,320 tests passing)

## Roadmap

See [ROADMAP.md](ROADMAP.md) for detailed status.

**Current focus:** Commercial distribution — binary compilation, licensing, landing page, documentation site.

---

## License

MIT
