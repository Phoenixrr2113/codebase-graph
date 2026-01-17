# CodeGraph

Visual codebase knowledge graph that parses source code to extract entities and relationships, stores them in FalkorDB, and renders an interactive graph visualization.

![CodeGraph](https://img.shields.io/badge/FalkorDB-Graph%20Database-blue) ![TypeScript](https://img.shields.io/badge/TypeScript-5.x-blue) ![Next.js](https://img.shields.io/badge/Next.js-16-black)

## Features

- **AST Parsing** - Tree-sitter based extraction of functions, classes, interfaces, types, variables, and React components
- **Semantic Edges** - Automatically detects CALLS, IMPORTS, EXTENDS, IMPLEMENTS, CONTAINS, and RENDERS relationships
- **Interactive Graph** - Cytoscape.js powered visualization with filtering by node and edge types
- **Deep Analysis** - Optional cross-file call resolution and external dependency tracking
- **Real-time Updates** - WebSocket notifications for file changes (when watching)
- **Source Preview** - Syntax-highlighted code preview panel with entity navigation

## Quick Start

```bash
# Install dependencies
pnpm install

# Start FalkorDB
docker-compose up -d falkordb

# Start development servers (API + Web)
pnpm dev
```

Then open [http://localhost:3000](http://localhost:3000) and add a project to parse.

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                      Frontend (Next.js)                     │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────────────┐  │
│  │ Graph View  │  │ Search/Query│  │  Source Preview     │  │
│  │ (Cytoscape) │  │   Panel     │  │    Panel            │  │
│  └─────────────┘  └─────────────┘  └─────────────────────┘  │
└────────────────────────────┬────────────────────────────────┘
                             │ REST + WebSocket
┌────────────────────────────┴────────────────────────────────┐
│                      API (Hono)                             │
│  /api/parse  /api/graph  /api/search  /api/projects  /ws    │
└────────────────────────────┬────────────────────────────────┘
                             │
┌────────────────────────────┴────────────────────────────────┐
│                    FalkorDB (Graph DB)                      │
│  Nodes: File, Function, Class, Interface, Type, Component  │
│  Edges: CONTAINS, CALLS, IMPORTS, EXTENDS, IMPLEMENTS      │
└─────────────────────────────────────────────────────────────┘
```

## Packages

| Package | Description |
|---------|-------------|
| `@codegraph/types` | Shared TypeScript types for entities and edges |
| `@codegraph/parser` | Tree-sitter AST parsing and entity extraction |
| `@codegraph/graph` | FalkorDB client, CRUD operations, and queries |
| `@codegraph/logger` | Structured logging with tracing support |
| `@codegraph/api` | Hono REST API server with WebSocket |
| `@codegraph/web` | Next.js 16 React 19 frontend |

## Commands

| Command | Description |
|---------|-------------|
| `pnpm install` | Install all dependencies |
| `pnpm build` | Build all packages |
| `pnpm dev` | Start API (3001) + Web (3000) dev servers |
| `pnpm test` | Run all tests |
| `pnpm clean` | Clean build artifacts |

## API Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/health` | Health check |
| GET | `/api/projects` | List parsed projects |
| POST | `/api/parse/project` | Parse a project directory |
| GET | `/api/graph/full` | Get full graph data |
| GET | `/api/search?q=...` | Search entities by name |
| GET | `/api/entity/:id` | Get entity details |
| GET | `/api/neighbors/:id` | Get connected nodes |
| POST | `/api/query/cypher` | Execute Cypher query |
| WS | `/ws` | Real-time file change events |

## Graph Schema

**Node Labels:**
- `File` - Source file with path, loc, hash
- `Function` - Function/method with params, async, arrow flags  
- `Class` - Class with extends, implements
- `Interface` - TypeScript interface
- `Type` - Type alias or enum
- `Variable` - const/let/var declaration
- `Component` - React component

**Edge Types:**
- `CONTAINS` - File contains entity
- `IMPORTS` - File imports from file
- `CALLS` - Function calls function
- `EXTENDS` - Class extends class
- `IMPLEMENTS` - Class implements interface
- `RENDERS` - Component renders component

## Tech Stack

- **Frontend**: Next.js 16, React 19, Cytoscape.js, Tailwind CSS v4, Zustand
- **API**: Hono, Node.js, WebSocket
- **Graph DB**: FalkorDB (Redis-compatible)
- **Parser**: Tree-sitter (WASM) for TypeScript/JavaScript/TSX/JSX
- **Build**: Turborepo, pnpm workspaces, TypeScript 5.x

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `API_PORT` | 3001 | API server port |
| `FALKORDB_HOST` | localhost | FalkorDB host |
| `FALKORDB_PORT` | 6379 | FalkorDB port |
| `FALKORDB_GRAPH` | codegraph | Graph name |
| `WATCH_PATH` | - | Auto-watch project path |

## License

MIT
