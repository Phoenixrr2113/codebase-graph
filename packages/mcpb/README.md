# @codegraph/mcpb

Private workspace builder for the platform-local CodeGraph MCPB desktop extension. It is an artifact-staging package, not a registry distribution.

The build bundles the compiled MCP server, copies its locked native parser dependencies, and produces `packages/mcpb/dist.mcpb`. Because native dependencies are copied from the current workspace, an artifact must be built and tested on the platform where it will be installed.

The server currently exposes five grouped tools: `analyze`, `codebase`, `knowledge`, `query`, and `search`. Raw handlers remain opt-in through `CODEGRAPH_RAW_TOOLS=true`.

The desktop bundle uses structural-only embeddings and an external FalkorDB connection by default. It does not package the local Transformer model or embedded FalkorDBLite platform binaries.

The root `build:mcpb` script builds the server and bundle, validates the generated directory, and packs the extension.
