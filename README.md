# CodeGraph - Visual Codebase Knowledge Graph

A visual knowledge graph that automatically parses source code to extract entities and relationships, stores them in FalkorDB, and renders an interactive graph visualization.

## Quick Start

```bash
# Install dependencies
pnpm install

# Start FalkorDB
docker-compose up -d falkordb

# Start development servers
pnpm dev
```

## Project Structure

```
codegraph/
├── packages/
│   ├── types/     # Shared TypeScript types (entities, edges, graph)
│   ├── parser/    # Tree-sitter code parsing
│   ├── graph/     # FalkorDB operations
│   ├── api/       # Hono REST API
│   └── web/       # Next.js 16 + React 19 frontend
├── docker-compose.yml
└── turbo.json
```

## Development

| Command | Description |
|---------|-------------|
| `pnpm install` | Install all dependencies |
| `pnpm build` | Build all packages |
| `pnpm dev` | Start all dev servers |
| `pnpm test` | Run tests |
| `pnpm clean` | Clean build artifacts |

## Stack

- **Frontend**: Next.js 16, React 19, Cytoscape.js, Tailwind CSS v4
- **API**: Hono + Node.js
- **Graph DB**: FalkorDB
- **Parser**: Tree-sitter (WASM)
- **Build**: Turborepo + pnpm

## License

MIT
