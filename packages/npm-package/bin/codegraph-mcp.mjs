#!/usr/bin/env node
/**
 * CodeGraph MCP Server — CLI entry point
 *
 * Usage:
 *   codegraph-mcp                          # start MCP server (stdio transport)
 *   npx @codegraph/mcp                     # run without global install
 *
 * Environment:
 *   CODEGRAPH_LICENSE        — License key (required, purchase at polar.sh/codegraph)
 *   VOYAGE_API_KEY           — Voyage AI API key (for embeddings)
 *   JINA_API_KEY             — Jina AI API key (for reranking)
 *   CODEGRAPH_DRIVER         — Database driver: falkordb (default) or falkordblite
 *   CODEGRAPH_DB_PATH        — Database path for falkordblite (default: .codegraph/falkordb)
 */

import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const serverPath = join(__dirname, '..', 'server', 'index.mjs');

// Force logs to stderr (MCP stdio requires clean stdout)
process.env.CODEGRAPH_LOG_STDERR = 'true';

// Import and run
await import(serverPath);
