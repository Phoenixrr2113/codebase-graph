# @codegraph/mcpb

MCP Bundle (MCPB) for the CodeGraph server in Claude Desktop and other compatible MCP clients.

This is a **build artifact**, not a development package. It bundles the MCP server and all dependencies into a single deployable unit.

## What It Produces

The `build.mjs` script generates a `dist/` directory containing:

```
dist/
  manifest.json          # MCPB manifest with tool definitions and user config schema
  package.json           # ESM package metadata
  icon.png               # Extension icon
  server/
    index.mjs            # esbuild-bundled MCP server (single file)
    node_modules/        # Native modules (tree-sitter grammars, MCP SDK)
```

## Build Process

1. **esbuild** bundles `packages/mcp-server/dist/index.js` into a single ESM file targeting Node 20
2. Native modules that cannot be bundled are kept external and copied separately:
   - `tree-sitter` + all grammar packages (native `.node` bindings)
   - `@huggingface/transformers` + `onnxruntime-node` (optional local embeddings)
   - `@modelcontextprotocol/sdk` (wildcard exports incompatible with bundling)
   - `falkordblite` (optional native dependency)
3. MCP SDK runtime dependencies are installed via `npm install --production` into the bundle
4. MCP SDK imports in the bundle are patched to add `.js` extensions for Node ESM resolution
5. `manifest.json` and `icon.png` are copied into the output

## manifest.json

Defines the extension metadata, tools, user configuration, and server entry point. Key sections:

- **tools**: `search`, `codebase`, `knowledge`, `query`
- **user_config**: Prompts for project paths and optional external FalkorDB host/port
- **server.mcp_config**: The `node` command and environment variables used to launch the server
- **compatibility**: Node >= 20 and the platform where the bundle was built

The generated bundle defaults to `CODEGRAPH_EMBEDDING_PROVIDER=none`, so API keys are not required for structural search.

## How to Build

```bash
# From the monorepo root: build the MCP server first, then the bundle
pnpm --filter @codegraph/mcpb build
```

## How to Pack

```bash
pnpm exec mcpb pack packages/mcpb/dist
# Produces codegraph-0.1.0.mcpb
```

The `.mcpb` file can be distributed to users and installed in Claude Desktop.
