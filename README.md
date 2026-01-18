# CodeGraph

Visual codebase knowledge graph that parses source code to extract entities and relationships, stores them in FalkorDB, and renders an interactive graph visualization.

![CodeGraph](https://img.shields.io/badge/FalkorDB-Graph%20Database-blue) ![TypeScript](https://img.shields.io/badge/TypeScript-5.7-blue) ![Next.js](https://img.shields.io/badge/Next.js-16-black)

## Features

- **Multi-Language Parsing** - Plugin-based architecture supporting TypeScript, JavaScript, Python, and C#
- **AST Extraction** - Tree-sitter based extraction of functions, classes, interfaces, types, variables, and React components
- **Semantic Edges** - Automatically detects CALLS, IMPORTS, EXTENDS, IMPLEMENTS, CONTAINS, and RENDERS relationships
- **Interactive Graph** - Cytoscape.js powered visualization with multiple layouts (Force, Hierarchical)
- **Graph Controls** - Zoom, fit, layout switching, and spread button to disperse clustered nodes
- **Deep Analysis** - Optional cross-file call resolution and external dependency tracking
- **Real-time Updates** - WebSocket notifications for file changes (when watching)
- **Entity Detail Panel** - Shows relationships, properties, and syntax-highlighted source preview

## Quick Start

```bash
# Install dependencies
pnpm install

# Start FalkorDB + API + Web dev servers
pnpm start
```

Then open [http://localhost:3000](http://localhost:3000) and add a project to parse.

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                      Frontend (Next.js)                     │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────────────┐  │
│  │ Graph View  │  │ Entity      │  │  Source Preview     │  │
│  │ (Cytoscape) │  │  Detail     │  │    Panel            │  │
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
| `@codegraph/parser` | Tree-sitter AST parsing coordinator |
| `@codegraph/plugin-typescript` | TypeScript/JavaScript/TSX/JSX language plugin |
| `@codegraph/plugin-python` | Python language plugin with import resolution |
| `@codegraph/plugin-csharp` | C# language plugin with namespace support |
| `@codegraph/graph` | FalkorDB client, CRUD operations, and queries |
| `@codegraph/logger` | Structured logging with tracing support |
| `@codegraph/api` | Hono REST API server with WebSocket |
| `@codegraph/web` | Next.js 16 / React 19 frontend |

## Commands

| Command | Description |
|---------|-------------|
| `pnpm install` | Install all dependencies |
| `pnpm start` | Start FalkorDB + API + Web (recommended) |
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
| DELETE | `/api/projects/:id` | Delete a project |
| GET | `/api/graph/full` | Get full graph data |
| GET | `/api/search?q=...` | Search entities by name |
| GET | `/api/entity/:id` | Get entity details |
| GET | `/api/neighbors/:id` | Get connected nodes |
| GET | `/api/source?path=...` | Get source code content |
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
- `External` - External dependency (library, framework)

**Edge Types:**
- `CONTAINS` - File contains entity
- `IMPORTS` - File imports from file/namespace
- `CALLS` - Function calls function
- `EXTENDS` - Class extends class
- `IMPLEMENTS` - Class implements interface
- `RENDERS` - Component renders component

## Supported Languages

| Language | Extensions | Features |
|----------|------------|----------|
| TypeScript | `.ts`, `.tsx` | Full entity extraction, CALLS, RENDERS |
| JavaScript | `.js`, `.jsx` | Full entity extraction, CALLS, RENDERS |
| Python | `.py` | Classes, functions, imports with path resolution |
| C# | `.cs` | Classes, interfaces, methods, EXTENDS, IMPLEMENTS |

## Tech Stack

- **Frontend**: Next.js 16, React 19, Cytoscape.js 3.33, Tailwind CSS 4, Zustand 5
- **API**: Hono, Node.js 20+, WebSocket
- **Graph DB**: FalkorDB (Redis-compatible)
- **Parsing**: Tree-sitter (WASM) with language-specific plugins
- **Build**: Turborepo, pnpm workspaces, TypeScript 5.7

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
