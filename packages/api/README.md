# @codegraph/api

REST API and WebSocket server for CodeGraph, built with [Hono](https://hono.dev).

## Overview

The API package provides an HTTP interface to CodeGraph's parsing and search capabilities. It includes WebSocket support for live updates during indexing and file watching.

## Endpoints

| Route | Methods | Description |
|-------|---------|-------------|
| `/health` | `GET` | Health check |
| `/api/parse` | `POST`, `DELETE` | Parse/index projects, clear graph |
| `/api/graph` | `GET` | Graph data (nodes, edges) with pagination |
| `/api/entity` | `GET` | Entity details by ID |
| `/api/neighbors` | `GET` | Node neighbors and relationships |
| `/api/stats` | `GET` | Graph-wide statistics |
| `/api/query` | `POST` | Cypher queries |
| `/api/search` | `GET` | Search by name, type, or keyword |
| `/api/source` | `GET` | Read source code files |
| `/api/projects` | `GET`, `POST` | Project management |
| `/api/nodes` | `GET` | Node listing with filtering |
| `/api/analytics` | `GET` | Analytics dashboard data |

## Running

### Development (with Docker FalkorDB)

```bash
# From monorepo root
pnpm docker:db      # Start FalkorDB
pnpm dev:api        # Start API on port 3001

# Or start everything
pnpm start          # FalkorDB + API + Web
```

### Docker

```bash
# Via docker compose (starts FalkorDB + API + Web)
docker compose --profile full up -d
```

The API service is available at `http://localhost:3001`.

## Configuration

The API reads configuration from environment variables:

```env
FALKORDB_HOST=localhost    # FalkorDB host (default: localhost)
FALKORDB_PORT=6379         # FalkorDB port (default: 6379)
API_PORT=3001              # API server port (default: 3001)
```

See `.env.template` in the project root for all available options.

## Architecture

```
Hono App
  ├── CORS middleware (localhost:3000)
  ├── Request logging
  ├── Error handling
  ├── 11 route modules
  ├── WebSocket (live indexing updates)
  └── File watcher integration
        │
        ▼
  @codegraph/core (service layer)
        │
        ▼
  @codegraph/graph (database driver)
```

## Tests

Test files covering app setup, git service, and model layer.

```bash
cd packages/api
pnpm exec vitest run
```
