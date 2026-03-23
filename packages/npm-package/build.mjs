#!/usr/bin/env node
/**
 * Build script for CodeGraph npm distribution package.
 *
 * Reuses the MCPB esbuild pipeline (packages/mcpb/build.mjs) to produce
 * a bundled server, then packages it for npm publishing.
 *
 * Run from repo root: node packages/npm-package/build.mjs
 * Or: pnpm build:npm
 */

import { cpSync, mkdirSync, rmSync, existsSync, readFileSync, writeFileSync, chmodSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execSync } from 'node:child_process';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '../..');
const MCPB_DIST = resolve(ROOT, 'packages/mcpb/dist');
const NPM_DIST = resolve(__dirname, 'dist');

// Step 1: Ensure MCPB is built (reuse its bundling)
const mcpbBundle = resolve(MCPB_DIST, 'server/index.mjs');
if (!existsSync(mcpbBundle)) {
  console.log('MCPB bundle not found — building first...');
  execSync('node packages/mcpb/build.mjs', { cwd: ROOT, stdio: 'inherit' });
}

// Step 2: Clean and create npm dist
if (existsSync(NPM_DIST)) rmSync(NPM_DIST, { recursive: true });
mkdirSync(resolve(NPM_DIST, 'server'), { recursive: true });
mkdirSync(resolve(NPM_DIST, 'bin'), { recursive: true });

// Step 3: Copy bundled server + native modules from MCPB
cpSync(resolve(MCPB_DIST, 'server'), resolve(NPM_DIST, 'server'), { recursive: true });
console.log('Copied bundled server from MCPB build');

// Step 4: Copy bin entry point
cpSync(resolve(__dirname, 'bin/codegraph-mcp.mjs'), resolve(NPM_DIST, 'bin/codegraph-mcp.mjs'));
chmodSync(resolve(NPM_DIST, 'bin/codegraph-mcp.mjs'), 0o755);

// Step 5: Copy package files
cpSync(resolve(__dirname, 'postinstall.mjs'), resolve(NPM_DIST, 'postinstall.mjs'));

// Step 6: Create package.json for publishing (read from source, adjust paths)
const pkgSource = JSON.parse(readFileSync(resolve(__dirname, 'package.json'), 'utf-8'));
// Remove build script from published package
delete pkgSource.scripts.build;
writeFileSync(resolve(NPM_DIST, 'package.json'), JSON.stringify(pkgSource, null, 2));

// Step 7: Create LICENSE
writeFileSync(resolve(NPM_DIST, 'LICENSE'), `CodeGraph Commercial License

Copyright (c) ${new Date().getFullYear()} Randy Wilson. All rights reserved.

This software is licensed, not sold. You must purchase a valid license key
from https://polar.sh/codegraph to use this software.

Unauthorized copying, redistribution, or reverse engineering of this
software is prohibited.

For licensing inquiries, contact: support@codegraph.dev
`);

// Step 8: Create README
writeFileSync(resolve(NPM_DIST, 'README.md'), `# CodeGraph MCP Server

Index any codebase into a graph database. Search by meaning, trace relationships, and manage project knowledge.

## Installation

\`\`\`bash
npm install -g @codegraph/mcp
\`\`\`

## Quick Start

1. Get a license key at [polar.sh/codegraph](https://polar.sh/codegraph)
2. Get API keys from [Voyage AI](https://dash.voyageai.com) and [Jina AI](https://jina.ai)
3. Add to your \`.mcp.json\`:

\`\`\`json
{
  "mcpServers": {
    "codegraph": {
      "command": "codegraph-mcp",
      "env": {
        "CODEGRAPH_LICENSE": "your-license-key",
        "VOYAGE_API_KEY": "your-voyage-key",
        "JINA_API_KEY": "your-jina-key"
      }
    }
  }
}
\`\`\`

## Tools

- **search** — Find code by meaning (vector + cross-encoder reranking)
- **knowledge** — Store and recall project knowledge
- **codebase** — Index management, status, source reading
- **query** — Raw Cypher queries against the code graph

## Features

- 42+ languages via Tree-sitter
- Vector search with cross-encoder reranking (94.4% MRR)
- FalkorDB graph database (Docker or embedded)
- Knowledge graph for storing project context

## Docs

[codegraph.dev/docs](https://codegraph.dev/docs)
`);

// Report
const serverSize = readFileSync(resolve(NPM_DIST, 'server/index.mjs')).length;
const nmSize = execSync(`du -sh ${resolve(NPM_DIST, 'server/node_modules')} 2>/dev/null || echo "0\t-"`)
  .toString().trim().split('\t')[0];

console.log(`\n✅ npm package built!`);
console.log(`   Bundle: ${(serverSize / 1024 / 1024).toFixed(1)} MB`);
console.log(`   Native modules: ${nmSize}`);
console.log(`   Output: ${NPM_DIST}`);
console.log(`\nTo publish:`);
console.log(`   cd ${NPM_DIST}`);
console.log(`   npm publish --access public`);
