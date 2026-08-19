#!/usr/bin/env node
/**
 * CodeGraph dashboard CLI entry point.
 *
 * Starts the REST API and serves the built dashboard from the same origin, so
 * the browser needs no cross-origin allowance and one process covers both.
 *
 * Usage:
 *   codegraph-dashboard                    # start on http://localhost:3001
 *   API_PORT=4000 codegraph-dashboard      # start on another port
 *
 * Environment:
 *   API_PORT / PORT               Listening port (default 3001)
 *   CODEGRAPH_EMBEDDING_PROVIDER  Embedding provider or "none" for offline mode
 *   CODEGRAPH_DRIVER              Database driver: falkordb or falkordblite
 *   CODEGRAPH_DB_PATH             Database path for falkordblite
 *   CODEGRAPH_DASHBOARD_DIR       Override the built dashboard location
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const serverPath = join(__dirname, '..', 'server', 'dashboard.mjs');

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
    process.stderr.write('codegraph-dashboard: unable to read package version\n');
    process.exitCode = 1;
  }
} else {
  await import(pathToFileURL(serverPath).href);
}
