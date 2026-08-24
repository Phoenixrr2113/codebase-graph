# @codegraph/graph

Private workspace package for CodeGraph storage drivers, graph operations, read queries, analysis queries, and knowledge operations.

## Driver selection

`createClient()` accepts an explicit `falkordblite` or `falkordb` driver. Without an explicit driver, configured external connection variables select FalkorDB. Otherwise CodeGraph selects embedded FalkorDBLite on Linux x64 and Apple silicon macOS when its native requirements and package are available, then falls back to external FalkorDB.

Embedded platform packages bundle both `redis-server` and the FalkorDB module binary. Users do not install a separate Redis server for FalkorDBLite. Apple silicon macOS requires Homebrew `libomp` and `openssl@3`; Linux x64 has no additional database runtime prerequisite.

External FalkorDB remains available through `FALKORDB_URL` or host and port settings for unsupported embedded platforms and managed services.

## Embedded lifecycle

- One process acquires the data-path lease and owns the embedded server.
- Later processes using the same data path attach through the published Unix socket.
- Closing an attached process does not release the owner's lease or stop the server.
- If a configured Unix data path is too long for the socket limit, it relocates deterministically to `~/.codegraph/graphs/<12-hex-digest>`.
- The owner closes the embedded database, persists its final snapshot, and releases the lease.

## Main interfaces

- `GraphClient`: query, read-only query, schema setup, connection close, and dialect access.
- `createOperations()`: graph writes, indexing primitives, vector search, and project cleanup.
- `createQueries()`: graph windows, statistics, context, source relationships, and git-backed analysis.
- `createKnowledgeOperations()`: temporal knowledge entities, relationships, facts, recall, and maintenance.
- `createOwnershipQuery()`: per-file authorship ranking from indexed git history.

## Embedding schema profile

Schema setup persists the embedding provider, model, and dimension. A later request with a different profile is rejected unless an explicit migration path is used. `none` has dimension 0; the default local profile has dimension 768. This guard prevents vectors created for incompatible profiles from sharing one index.

## Configuration inputs

The graph name defaults to `codegraph`. `CODEGRAPH_DB_PATH` selects embedded storage. `FALKORDB_URL`, `FALKORDB_HOST`, and `FALKORDB_PORT` configure an external service. A project `.codegraph/config.json` may also provide driver settings, and relative database paths in that file resolve from the config directory.
