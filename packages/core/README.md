# @codegraph/core

Private workspace facade for CodeGraph indexing, search, project setup, source access, and git synchronization. The MCP server and REST API consume this package; it is not a separately published distribution.

## Responsibilities

- Register language plugins and parse supported source files.
- Build and persist nodes and relationships through `@codegraph/graph`.
- Coordinate full, incremental, and single-file indexing.
- Resolve the embedding profile and block writes when a persisted profile requires migration.
- Search by name or vector similarity, with optional reranking when a supported provider is configured.
- Persist git history using a default initial window of 365 days and 10,000 commits. Later requests may widen, but do not narrow, the stored window.
- Expose project configuration, setup status, source reading, file watching, and service facades.

With no provider or cloud key configured, embeddings use the local `nomic-ai/nomic-embed-text-v1.5` profile at 768 dimensions. Explicit `none` mode disables semantic embeddings. Jina reranking is not supported.

## Main exports

- `indexProject`, `indexSingleFile`, and embedding coordination
- `codeGraphService` and `knowledgeService`
- parsing and plugin registration helpers
- `syncGitHistory` and repository metadata helpers
- setup-status and embedding-migration helpers
- configuration, source-reading, and watch services

Build and tests are driven from the monorepo root through Turbo and the package scripts in `package.json`.
