# @codegraph/graph

Driver-agnostic graph database client for CodeGraph. Supports both **FalkorDB** (client-server, Docker) and **Kuzu** (embedded, zero infrastructure).

## Driver Abstraction

The package provides a `DatabaseDriver` interface and `CypherDialect` abstraction that allows all graph operations to work identically across both backends.

```
createClient()
  ├── reads .codegraph/config.json (auto-detected up to 5 parent dirs)
  ├── falls back to CODEGRAPH_DRIVER env var
  ├── auto-detects Kuzu if .codegraph/kuzu/ exists on disk
  └── defaults to FalkorDB
```

### Key Interfaces

- **`DatabaseDriver`** — Connect, query, close. Implemented by `FalkorDBDriver` and `KuzuDriver`.
- **`CypherDialect`** — Generates driver-specific Cypher fragments (`label()` vs `labels()`, node normalization, label checks). MCP tools and queries use this to emit compatible Cypher for either backend.
- **`GraphClient`** — High-level client returned by `createClient()`. Exposes `query()`, `roQuery()`, `ensureIndexes()`, `close()`, and `dialect`.
- **`GraphOperations`** — CRUD operations (upsert files, functions, classes, edges).
- **`GraphQueries`** — Read queries (search, subgraph, stats, dependency tree).

### Usage

```typescript
import { createClient, createOperations, createQueries } from '@codegraph/graph';

// Auto-detect backend from config file / env vars
const client = await createClient();
const ops = createOperations(client);
const queries = createQueries(client);

// All queries are driver-agnostic
await ops.upsertFile({ path: '/src/index.ts', name: 'index.ts', extension: 'ts', loc: 42 });
const results = await queries.searchByName('createClient');

await client.close();
```

### Explicit Driver Selection

```typescript
// Kuzu (embedded)
const client = await createClient({
  driver: 'kuzu',
  databasePath: '.codegraph/kuzu',
  graphName: 'codegraph',
});

// FalkorDB (Docker/cloud)
const client = await createClient({
  driver: 'falkordb',
  host: 'localhost',
  port: 6379,
  graphName: 'codegraph',
});
```

## Drivers

### FalkorDB (`drivers/falkordb.ts`)

- Client-server via Redis protocol
- Requires Docker or FalkorDB Cloud
- Supports `ON CREATE SET` / `ON MATCH SET`
- Node results: `{ properties: { ... } }` (nested)
- Labels: `labels(n)` returns `string[]`

### Kuzu (`drivers/kuzu.ts`)

- Embedded, in-process (no Docker, no network)
- Explicit schema required (`CREATE NODE TABLE ...`)
- No `ON CREATE SET` / `ON MATCH SET` — uses simple `MERGE ... SET`
- Node results: `{ _label, _id, prop1, prop2, ... }` (flat)
- Labels: `label(n)` returns `string`
- Requires explicit `QueryResult.close()` to prevent SIGSEGV on exit

### Kuzu Schema (`drivers/kuzu-schema.ts`)

DDL for all node and relationship tables. Node tables require a single primary key column (`id STRING PRIMARY KEY`). Tables are created with `IF NOT EXISTS` for idempotency.

## Config File

Place `.codegraph/config.json` in your project root:

```json
{
  "driver": "kuzu",
  "databasePath": ".codegraph/kuzu",
  "graphName": "codegraph"
}
```

Relative paths in `databasePath` are resolved against the directory containing the config file, so the MCP server works correctly regardless of which subdirectory it runs from.
