# CodeGraph

**Understand your codebase at a glance.** CodeGraph parses your source code, builds a knowledge graph of every function, class, and relationship, then lets you explore, analyze, and query it—visually or through AI assistants.

![FalkorDB](https://img.shields.io/badge/FalkorDB-Graph%20Database-blue)
![Kuzu](https://img.shields.io/badge/Kuzu-Embedded%20Graph-blue)
![TypeScript](https://img.shields.io/badge/TypeScript-5.7-blue)
![Next.js](https://img.shields.io/badge/Next.js-16-black)
![React](https://img.shields.io/badge/React-19-61dafb)
![MCP](https://img.shields.io/badge/MCP-14%20Tools-green)
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
│  • Functions, Classes, Components, Interfaces               │
│  • CALLS, IMPORTS, EXTENDS, IMPLEMENTS relationships        │
│  • Complexity metrics, security vulnerabilities             │
│  • Git history integration                                  │
└─────────────────────────────────────────────────────────────┘
```

## Quick Start

### Option A: Kuzu (Embedded, No Docker)

The fastest way to get started. Kuzu runs in-process with zero infrastructure:

```bash
# Clone and install
git clone https://github.com/your-org/codegraph.git
cd codegraph && pnpm install && pnpm build

# Extract your codebase (creates .codegraph/kuzu database)
pnpm codegraph extract ./src

# Query via MCP server or directly
pnpm codegraph search "auth"
```

A `.codegraph/config.json` file is created automatically:

```json
{
  "driver": "kuzu",
  "databasePath": ".codegraph/kuzu",
  "graphName": "codegraph"
}
```

### Option B: FalkorDB (Client-Server, Docker)

For production deployments or when you want a shared graph server:

```bash
# Clone and install
git clone https://github.com/your-org/codegraph.git
cd codegraph && pnpm install

# Start FalkorDB via Docker
pnpm docker:db

# Configure connection
cp .env.template .env
# Edit .env with your FalkorDB credentials

# Start everything
pnpm start  # Docker + API + Web
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

```bash
# In your MCP config, add:
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

### 3. Security Scanning

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

### 4. Complexity Hotspots

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

### 5. Direct Graph Queries

Run Cypher queries for custom analysis:

```cypher
// Find all functions that call external APIs but have no tests
MATCH (f:Function)-[:CALLS]->(e:External)
WHERE NOT EXISTS { MATCH (t:File)-[:CONTAINS]->(test:Function)
                   WHERE test.name CONTAINS 'test' AND (test)-[:CALLS]->(f) }
RETURN f.name, f.file, e.name
```

## What Gets Extracted

| Language | Entities | Relationships |
|----------|----------|---------------|
| TypeScript/JavaScript | Functions, Classes, Interfaces, Types, Components | CALLS, IMPORTS, RENDERS, EXPORTS, EXTENDS |
| Python | Functions, Classes | CALLS, IMPORTS |
| C# | Classes, Interfaces, Methods | CALLS, EXTENDS, IMPLEMENTS |

**Analysis Capabilities:**
- **Complexity** — Cyclomatic, cognitive, nesting depth
- **Security** — OWASP Top 10 + payment-specific rules (Stripe, Adyen)
- **Dataflow** — Taint tracking from sources to sinks
- **Git History** — Commits linked to code changes

## MCP Server (14 Tools)

The MCP server enables AI assistants to query your codebase:

| Category | Tools |
|----------|-------|
| Index | `get_index_status`, `trigger_reindex` |
| Search | `find_symbol`, `search_code`, `query_graph` |
| Analysis | `analyze_impact`, `find_vulnerabilities`, `get_complexity_report`, `trace_data_flow` |
| Context | `explain_code`, `get_symbol_history`, `get_repo_map`, `analyze_file_for_refactoring` |

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                      Frontend (Next.js 16)                  │
│     Interactive Graph • Entity Detail • Source Preview      │
└───────────────────────────────┬─────────────────────────────┘
                                │ REST + WebSocket
┌───────────────────────────────┴─────────────────────────────┐
│                      API (Hono)                             │
│   Parse Service • Analysis Engine • Git Integration         │
└───────────────────────────────┬─────────────────────────────┘
                                │
┌───────────────────────────────┴─────────────────────────────┐
│              Graph Database (Driver Abstraction)             │
│   ┌───────────────────┐    ┌────────────────────────┐       │
│   │  FalkorDB Driver  │ OR │  Kuzu Driver (embedded) │      │
│   └───────────────────┘    └────────────────────────┘       │
│   Nodes: File, Function, Class, Component, Commit           │
│   Edges: CALLS, IMPORTS, EXTENDS, RENDERS, FLOWS_TO         │
└─────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────┐
│                    MCP Server (stdio)                       │
│           14 tools for Claude, Cursor, etc.                 │
└─────────────────────────────────────────────────────────────┘
```

The graph layer is **driver-agnostic** via a `DatabaseDriver` + `CypherDialect` abstraction.
Both backends share the same Cypher queries, operations, and MCP tools.

## Configuration

### Config File (Recommended)

Create `.codegraph/config.json` in your project root:

```json
{
  "driver": "kuzu",
  "databasePath": ".codegraph/kuzu",
  "graphName": "codegraph"
}
```

The config file is automatically discovered by searching the current directory and up to 5 parent directories. Relative paths in `databasePath` are resolved against the directory containing the config file.

### Environment Variables

```env
# Driver selection
CODEGRAPH_DRIVER=kuzu          # or "falkordb" (default)
CODEGRAPH_DB_PATH=.codegraph/kuzu  # Kuzu database directory

# FalkorDB connection (when using FalkorDB driver)
FALKORDB_URL=your-instance.cloud:port
FALKORDB_USERNAME=falkordb
FALKORDB_PASSWORD=your-password
FALKORDB_HOST=localhost
FALKORDB_PORT=6379
FALKORDB_GRAPH=codegraph
```

### Auto-Detection

If no config file or environment variable is set, CodeGraph checks if a Kuzu database
exists at `.codegraph/kuzu`. If found, it uses Kuzu automatically. Otherwise it falls
back to FalkorDB.

**Config priority:** Explicit arguments > `.codegraph/config.json` > Environment variables > Auto-detection

## Development

```bash
pnpm install   # Install dependencies
pnpm build     # Build all packages
pnpm dev       # Start dev servers (API:3001, Web:3000)
pnpm test      # Run tests
```

## Tech Stack

- **Frontend**: Next.js 16, React 19, Cytoscape.js, Tailwind CSS 4
- **API**: Hono, WebSocket
- **Parsing**: Tree-sitter (WASM)
- **Graph DB**: FalkorDB (client-server) or Kuzu (embedded)
- **Build**: Turborepo, pnpm workspaces
- **Testing**: Vitest (33 integration tests against real database)

## Roadmap

### Analytics & Dashboard
- [ ] Analytics dashboard — visualize complexity trends, security issues, code health over time
- [ ] Custom metrics — define your own rules and thresholds
- [ ] Team metrics — code ownership, review patterns, knowledge silos

### AI Integration
- [ ] Conversational agent — ask questions about your codebase in natural language
- [ ] Auto-generated documentation — AI-powered docs from code analysis
- [ ] Refactoring suggestions — AI-assisted code improvements

### Language & File Support
- [ ] More languages — Go, Rust, Java, Ruby, PHP
- [ ] Config files — package.json, tsconfig, Dockerfile analysis
- [ ] Documentation — Markdown linking, API doc extraction

### Infrastructure
- [x] Config file support — `.codegraph/config.json` with auto-detection
- [x] Swappable database backends — FalkorDB (Docker) or Kuzu (embedded, zero infra)
- [ ] CI/CD GitHub Actions — run analysis on every PR
- [ ] Cross-codebase analysis — analyze microservices as a unified graph
- [ ] Better logging — structured logs, log levels, external sinks

### Graph & UX
- [ ] Enhanced graph UI — filtering, grouping, time-travel views
- [ ] More node types — configs, tests, migrations, API routes
- [ ] More edge types — USES_CONFIG, TESTED_BY, MIGRATES

### Templates
- [ ] Project starter template — new projects with CodeGraph baked in from day one
- [ ] Pre-commit hooks — analyze before every commit
- [ ] IDE extensions — VS Code, Cursor integration

---

## License

MIT
