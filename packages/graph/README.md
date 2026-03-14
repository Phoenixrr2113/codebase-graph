# @codegraph/graph

Driver-agnostic graph database client for CodeGraph. Supports **FalkorDB** (client-server, Docker) and **FalkorDBLite** (embedded, no Docker). Includes a pluggable driver registry for adding new backends.

## Driver Abstraction

The package provides a `DatabaseDriver` interface that allows all graph operations to work identically across backends. All drivers share the same Cypher dialect (FalkorDB-compatible).

```
createClient()
  ├── reads explicit config argument
  ├── reads .codegraph/config.json (auto-detected up to 5 parent dirs)
  ├── falls back to CODEGRAPH_DRIVER env var
  └── defaults to FalkorDB
```

### Key Interfaces

- **`DatabaseDriver`** — Connect, query, close. Implemented by `FalkorDBDriver` and `FalkorDBLiteDriver`. New drivers register via `registerDriver()`.
- **`GraphClient`** — High-level client returned by `createClient()`. Exposes `query()`, `roQuery()`, `ensureIndexes()`, `close()`, and `dialect`.
- **`GraphOperations`** — CRUD operations (upsert files, functions, classes, edges) + vector search.
- **`GraphQueries`** — Read queries (search, subgraph, stats, dependency tree).
- **`KnowledgeOperations`** — Entity/relationship/fact storage, temporal memory (decay/prune), semantic search.

### Usage

```typescript
import { createClient, createOperations, createQueries, createKnowledgeOperations } from '@codegraph/graph';

// Auto-detect backend from config file / env vars
const client = await createClient();
const ops = createOperations(client);
const queries = createQueries(client);
const knowledgeOps = createKnowledgeOperations(client);

// All queries are driver-agnostic
await ops.upsertFile({ path: '/src/index.ts', name: 'index.ts', extension: 'ts', loc: 42 });
const results = await queries.searchByName('createClient');

// Knowledge graph operations
await knowledgeOps.upsertEntity({ text: 'Auth Service', type: 'SYSTEM', ... });
const related = await knowledgeOps.recall('Auth Service');

await client.close();
```

### Explicit Driver Selection

```typescript
// FalkorDBLite (embedded, no Docker)
const client = await createClient({
  driver: 'falkordblite',
  databasePath: '.codegraph/falkordb',
  graphName: 'codegraph',
});

// FalkorDB (Docker or cloud)
const client = await createClient({
  driver: 'falkordb',
  host: 'localhost',
  port: 6379,
  graphName: 'codegraph',
});

// Kuzu (legacy — not recommended for new projects)
const client = await createClient({
  driver: 'kuzu',
  databasePath: '.codegraph/kuzu',
  graphName: 'codegraph',
});
```

## Drivers

### FalkorDB (`drivers/falkordb.ts`) — Primary

- Client-server via Redis protocol
- Requires Docker (`docker compose up -d falkordb`) or FalkorDB Cloud
- Full Cypher support: `ON CREATE SET` / `ON MATCH SET`, `MERGE`, `UNWIND`
- Native HNSW vector indexes on nodes and relationships
- Vector search: `CALL db.idx.vector.queryNodes(label, property, k, vecf32(vec))`
- Node results: `{ properties: { ... } }` (nested)

### FalkorDBLite (`drivers/falkordblite.ts`) — Embedded

- Embedded FalkorDB engine, spawns a Redis subprocess
- No Docker, no external services (requires `redis-server` installed)
- Same Cypher API as full FalkorDB
- Platforms: macOS arm64, Linux x64
- npm: `falkordblite` v0.2.0 (optional dependency)
- API: `FalkorDB.open({ path })` → `db.selectGraph(name)` → same `Graph` type
- Close: `db.close()` stops subprocess + saves RDB snapshot

### Kuzu (`drivers/kuzu.ts`) — Legacy

- Embedded, in-process (no Docker, no network)
- **Deprecated**: Kuzu was acquired by Apple (Oct 2025), v0.11.3 is final
- Has 12+ behavioral workarounds (`_pk` keys, no `ON CREATE SET`, etc.)
- Kept for backward compatibility only; not recommended for new projects

## Vector Search

The graph layer supports native HNSW vector indexes for semantic search:

```typescript
// Vector indexes are created automatically by ensureSchema()
// 8 node types + RELATES_TO edge, all 768-dimensional (cosine)

// Search by vector similarity
const results = await ops.searchByVector('Function', embedding, 10);
// Returns: [{ node, score }]
```

**Important**: FalkorDB requires `vecf32()` to encode vectors. Raw JS arrays stored as embeddings become `List` type, not `Vectorf32`. The drivers handle this automatically.

## Knowledge Operations

The `KnowledgeOperations` module provides a full knowledge graph layer:

- **Entities**: CRUD with deduplication, type classification, embeddings
- **Relationships**: Typed edges between entities with temporal metadata
- **ABOUT edges**: Link knowledge entities to code entities (Function, Class, File, etc.)
- **Temporal memory**: `valid_at`/`invalid_at` timestamps, relevance decay, pruning
- **Semantic search**: Vector similarity search over entity embeddings
- **Conversation ingestion**: Episodic memory from multi-turn conversations

## Config File

Place `.codegraph/config.json` in your project root:

```json
{
  "driver": "falkordblite",
  "databasePath": ".codegraph/falkordb",
  "graphName": "codegraph"
}
```

Relative paths in `databasePath` are resolved against the directory containing the config file, so the MCP server works correctly regardless of which subdirectory it runs from.

## Tests

- **25 tests** — `falkordb-operations.test.ts` (CRUD, vector search against FalkorDB Docker)
- **17 tests** — `falkordb-knowledge-operations.test.ts` (knowledge ops against FalkorDB Docker)
- **9 tests** — `falkordblite.test.ts` (CRUD, vector search, knowledge ops against FalkorDBLite)
- Additional test files for queries, about-edges, and git operations

All integration tests run against real databases (no mocks).

```bash
# Run graph tests (requires Docker FalkorDB on localhost:6379)
cd packages/graph
pnpm exec vitest run

# Or from monorepo root
pnpm test --filter=@codegraph/graph
```
