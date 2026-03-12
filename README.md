# CodeGraph

**Understand your codebase at a glance.** CodeGraph parses your source code, builds a knowledge graph of every function, class, and relationship, then lets you explore, analyze, and query it—visually or through AI assistants.

![FalkorDB](https://img.shields.io/badge/FalkorDB-Graph%20Database-blue)
![FalkorDBLite](https://img.shields.io/badge/FalkorDBLite-Embedded-blue)
![TypeScript](https://img.shields.io/badge/TypeScript-5.7-blue)
![Next.js](https://img.shields.io/badge/Next.js-16-black)
![React](https://img.shields.io/badge/React-19-61dafb)
![MCP](https://img.shields.io/badge/MCP-28%20Tools-green)
![Tree-sitter](https://img.shields.io/badge/Tree--sitter-WASM-orange)
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
┌─────────────────────────────────────────────────────────────┐
│  Your Codebase → Parser → Graph DB → Insights              │
│                                                             │
│  • Functions, Classes, Components, Interfaces, Types        │
│  • CALLS, IMPORTS, EXTENDS, IMPLEMENTS, RENDERS edges       │
│  • Complexity metrics, security vulnerabilities             │
│  • Knowledge graph with temporal memory                     │
│  • Hybrid search (vector + text + graph traversal)          │
│  • Git history integration                                  │
└─────────────────────────────────────────────────────────────┘
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

# Configure connection
cp .env.template .env
# Edit .env with your FalkorDB credentials

# Start everything (Docker + API + Web)
pnpm start
```

Open [http://localhost:3000](http://localhost:3000), add a project, and start exploring.

## Usage Examples

### 1. Visual Graph Exploration

Parse any project and explore the interactive graph:
- **Double-click** nodes to expand neighbors
- **Search** by name to find any symbol
- **Click** any node to see its source code, relationships, and metrics

### 2. Impact Analysis via MCP

Connect to Claude or Cursor with the MCP server:

```json
{
  "codegraph": {
    "command": "node",
    "args": ["./packages/mcp-server/dist/index.js"]
  }
}
```

Then ask your AI assistant:
> "What functions are affected if I change `processPayment`?"

The `analyze_impact` tool returns direct callers, transitive dependencies, affected tests, and a risk score.

### 3. Hybrid Search

CodeGraph supports multiple search strategies that combine vector embeddings, text matching, and graph traversal:

```typescript
// MCP tool: search_code
// Strategies: VECTOR, HYBRID, GRAPH_ANSWER, NL_TO_CYPHER, SMART_SEARCH, CONTEXT_WALK
{
  "query": "authentication middleware",
  "strategy": "HYBRID"
}
```

### 4. Knowledge Graph

Store and query domain knowledge with temporal memory:

```typescript
// MCP tool: store_fact
{ "text": "The auth service was migrated from JWT to OAuth2 in March 2026" }
// Automatically extracts entities and relationships via LLM

// MCP tool: recall
{ "query": "auth service" }
// Returns all known facts, relationships, and temporal context
```

### 5. Security Scanning

Find vulnerabilities across your codebase:

```typescript
// MCP tool: find_vulnerabilities
{
  "vulnerabilities": [
    {
      "type": "SQL_INJECTION",
      "severity": "CRITICAL",
      "file": "src/db/users.ts",
      "line": 45,
      "description": "User input concatenated into SQL query",
      "fix": "Use parameterized queries"
    }
  ]
}
```

### 6. Complexity Hotspots

Identify functions that need refactoring:

```typescript
// MCP tool: get_complexity_report
{
  "hotspots": [
    { "name": "processOrder", "complexity": 28, "cognitive": 34, "file": "src/orders.ts" },
    { "name": "validateInput", "complexity": 22, "cognitive": 19, "file": "src/validation.ts" }
  ]
}
```

## What Gets Extracted

| Language | Entities | Relationships |
|----------|----------|---------------|
| TypeScript/JavaScript | Functions, Classes, Interfaces, Types, Components | CALLS, IMPORTS, RENDERS, EXPORTS, EXTENDS |
| Python | Functions, Classes | CALLS, IMPORTS |
| C# | Classes, Interfaces, Methods | CALLS, EXTENDS, IMPLEMENTS |
| Go | Functions, Structs, Interfaces | CALLS, IMPORTS, IMPLEMENTS |
| Java | Classes, Interfaces, Methods | CALLS, EXTENDS, IMPLEMENTS |
| Rust | Functions, Structs, Traits, Impls | CALLS, IMPORTS, IMPLEMENTS |
| PHP | Functions, Classes, Interfaces | CALLS, EXTENDS, IMPLEMENTS |
| Markdown | Documents, Sections, Links | LINKS_TO, REFERENCES |

**Analysis Capabilities:**
- **Complexity** — Cyclomatic, cognitive, nesting depth
- **Security** — OWASP Top 10 + payment-specific rules (Stripe, Adyen)
- **Dataflow** — Taint tracking from sources to sinks
- **Git History** — Commits linked to code changes
- **Knowledge Graph** — Entity/relationship extraction with temporal memory (decay, prune)
- **Embeddings** — Local (nomic-embed-text-v1.5, 768-dim) + cloud (OpenRouter)

## MCP Server (28 Tools)

The MCP server enables AI assistants to query your codebase:

| Category | Tools |
|----------|-------|
| Core | `ping`, `configure_projects` |
| Index | `get_index_status`, `trigger_reindex`, `get_stats` |
| Search | `find_symbol`, `search_code`, `search`, `get_context`, `query_graph` |
| AI Search | `ask_code`, `query_cypher` |
| Analysis | `analyze_impact`, `find_vulnerabilities`, `get_complexity_report`, `trace_data_flow` |
| Context | `explain_code`, `get_symbol_history`, `get_repo_map`, `get_source`, `analyze_file_for_refactoring` |
| Knowledge | `store_entity`, `store_relationship`, `store_fact`, `ingest_conversation`, `query_knowledge`, `recall`, `decay_and_prune`, `get_knowledge_stats` |

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                      Frontend (Next.js 16)                  │
│     Interactive Graph • Entity Detail • Source Preview      │
└───────────────────────────────────────────────────────────┬─┘
                                                            │ REST + WebSocket
┌───────────────────────────────────────────────────────────┴─┐
│                      API (Hono)                             │
│   Parse Service • Analysis Engine • Git Integration         │
└───────────────────────────────────────────────────────────┬─┘
                                                            │
┌───────────────────────────────────────────────────────────┴─┐
│              Graph Database (Driver Abstraction)             │
│   ┌──────────────────┐  ┌──────────────────┐                │
│   │ FalkorDB (Docker) │  │ FalkorDBLite     │                │
│   │ Team / Enterprise │  │ Local / Embedded │                │
│   └──────────────────┘  └──────────────────┘                │
│   Nodes: File, Function, Class, Component, Entity, Commit   │
│   Edges: CALLS, IMPORTS, EXTENDS, RENDERS, RELATES_TO       │
│   Vector: HNSW indexes on all node types + RELATES_TO edges │
└─────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────┐
│                    MCP Server (stdio)                        │
│              28 tools for Claude, Cursor, etc.              │
└─────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────┐
│                    NLP Pipeline                              │
│   Entity Extraction • Embeddings • Bridge Linking           │
│   Conversation Ingestion • Entity Resolution                │
│   Local: nomic-embed-text-v1.5 • Cloud: OpenRouter          │
└─────────────────────────────────────────────────────────────┘
```

## Packages

| Package | Description |
|---------|-------------|
| [`@codegraph/core`](packages/core/) | Main orchestrator — parsing, analysis, search, embedding, service layer |
| [`@codegraph/graph`](packages/graph/) | Driver-agnostic graph database client (FalkorDB, FalkorDBLite) |
| [`@codegraph/plugin-nlp`](packages/plugin-nlp/) | NLP extraction, embeddings, knowledge graph operations |
| [`@codegraph/mcp-server`](packages/mcp-server/) | MCP server with 28 tools for AI assistants |
| [`@codegraph/api`](packages/api/) | REST API + WebSocket server (Hono) |
| [`@codegraph/cli`](packages/cli/) | CLI for extracting and querying code graphs |
| [`@codegraph/web`](packages/web/) | Next.js 16 frontend with interactive graph visualization |
| [`@codegraph/logger`](packages/logger/) | Centralized structured logging |
| [`@codegraph/types`](packages/types/) | Shared TypeScript types |
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
# Driver selection (falkordb | falkordblite | kuzu)
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
pnpm dev            # Start dev servers (API:3001, Web:3000)
pnpm test           # Run all tests
pnpm docker:db      # Start FalkorDB via Docker
pnpm docker:reset   # Reset FalkorDB (wipe data)
```

## Tech Stack

- **Frontend**: Next.js 16, React 19, Cytoscape.js, Tailwind CSS 4
- **API**: Hono, WebSocket, Node.js
- **Parsing**: Tree-sitter (WASM) — 8 languages
- **Graph DB**: FalkorDB (Docker) or FalkorDBLite (embedded)
- **Embeddings**: Local (nomic-embed-text-v1.5) + Cloud (OpenRouter)
- **LLM**: Vercel AI SDK v6, multi-provider (OpenRouter, Ollama)
- **Build**: Turborepo, pnpm workspaces, ESM
- **Testing**: Vitest (56 test files, 51+ FalkorDB integration tests)

## Roadmap

### Completed
- [x] Config file support — `.codegraph/config.json` with auto-detection
- [x] Swappable database backends — FalkorDB (Docker) + FalkorDBLite (embedded)
- [x] 8 language extractors — TypeScript, Python, C#, Go, Java, Rust, PHP, Markdown
- [x] Knowledge graph — entity/relationship/fact storage with temporal memory
- [x] Hybrid search — vector + text + graph traversal + 6 search strategies
- [x] Embedding pipeline — local (nomic-embed-text-v1.5) + cloud (OpenRouter)
- [x] Conversation ingestion — episodic memory from multi-turn conversations
- [x] Git history integration — commits linked to code entities
- [x] Pipeline orchestration — Task wrapper, provenance, incremental processing

### Planned
- [ ] Production hardening — authentication, rate limiting, input validation
- [ ] CI/CD GitHub Actions — run analysis on every PR
- [ ] Cross-codebase analysis — analyze microservices as a unified graph
- [ ] Enhanced graph UI — filtering, grouping, time-travel views
- [ ] IDE extensions — VS Code, Cursor integration
- [ ] More languages — Ruby

---

## License

MIT
