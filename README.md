# CodeGraph

**Understand your codebase at a glance.** CodeGraph parses your source code, builds a knowledge graph of every function, class, and relationship, then lets you explore, analyze, and query it—visually or through AI assistants.

![FalkorDB](https://img.shields.io/badge/FalkorDB-Graph%20Database-blue)
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

```bash
# Clone and install
git clone https://github.com/your-org/codegraph.git
cd codegraph && pnpm install

# Configure FalkorDB (cloud or local)
cp .env.template .env
# Edit .env with your FalkorDB credentials

# Start everything
pnpm start  # Docker + API + Web

# Or, if using FalkorDB Cloud:
pnpm dev    # Just API + Web
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
│                    FalkorDB (Graph DB)                      │
│   Nodes: File, Function, Class, Component, Commit           │
│   Edges: CALLS, IMPORTS, EXTENDS, RENDERS, FLOWS_TO         │
└─────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────┐
│                    MCP Server (stdio)                       │
│           14 tools for Claude, Cursor, etc.                 │
└─────────────────────────────────────────────────────────────┘
```

## Configuration

```env
# FalkorDB Cloud (recommended)
FALKORDB_URL=your-instance.cloud:port
FALKORDB_USERNAME=falkordb
FALKORDB_PASSWORD=your-password

# Or local Docker
FALKORDB_HOST=localhost
FALKORDB_PORT=6379

# Graph name
FALKORDB_GRAPH=codegraph
```

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
- **Graph DB**: FalkorDB
- **Build**: Turborepo, pnpm workspaces

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
- [ ] YAML/ENV configuration — fully configurable via `codegraph.yml`
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
