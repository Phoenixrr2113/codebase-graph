#!/usr/bin/env node
/**
 * CodeGraph MCP Server CLI entry point
 *
 * Usage:
 *   codegraph-mcp                          # start MCP server (stdio transport)
 *   npx codegraph-mcp                      # run without global install
 *
 * Environment:
 *   CODEGRAPH_EMBEDDING_PROVIDER  Embedding provider or "none" for offline mode
 *   CODEGRAPH_DRIVER              Database driver: falkordb or falkordblite
 *   CODEGRAPH_DB_PATH             Database path for falkordblite
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const serverPath = join(__dirname, '..', 'server', 'index.mjs');

function readPackageVersion() {
  const manifest = JSON.parse(
    readFileSync(new URL('../package.json', import.meta.url), 'utf8'),
  );
  if (
    typeof manifest !== 'object' ||
    manifest === null ||
    manifest.name !== 'codegraph-mcp' ||
    typeof manifest.version !== 'string'
  ) {
    throw new Error('invalid package manifest');
  }
  return manifest.version;
}

if (process.argv.includes('--version') || process.argv.includes('-v')) {
  try {
    process.stdout.write(`${readPackageVersion()}\n`);
  } catch {
    process.stderr.write('codegraph-mcp: unable to read package version\n');
    process.exitCode = 1;
  }
} else {
  // MCP stdio reserves stdout for protocol messages.
  process.env.CODEGRAPH_LOG_STDERR = 'true';

  await import(serverPath);
}
