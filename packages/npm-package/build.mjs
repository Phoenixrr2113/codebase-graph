#!/usr/bin/env node

import {
  chmodSync,
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { createPublishedManifest } from './lib/package-metadata.mjs';

const packageDirectory = dirname(fileURLToPath(import.meta.url));
const rootDirectory = resolve(packageDirectory, '../..');
const outputDirectory = resolve(packageDirectory, 'dist');
const serverEntry = resolve(rootDirectory, 'packages/mcp-server/dist/index.js');
const dashboardServerEntry = resolve(rootDirectory, 'packages/api/dist/index.js');
const dashboardEsmLoader = resolve(rootDirectory, 'packages/api/dist/esm-loader.js');
const dashboardAssets = resolve(rootDirectory, 'packages/dashboard/dist');

function readManifest(relativePath) {
  const path = resolve(rootDirectory, relativePath);
  const parsed = JSON.parse(readFileSync(path, 'utf8'));
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new TypeError(`${relativePath} must contain a JSON object`);
  }
  return parsed;
}

if (!existsSync(serverEntry)) {
  throw new Error(
    'Missing packages/mcp-server/dist/index.js. Build workspace packages before creating the npm distribution.',
  );
}

if (!existsSync(dashboardServerEntry)) {
  throw new Error(
    'Missing packages/api/dist/index.js. Build workspace packages before creating the npm distribution.',
  );
}

if (!existsSync(dashboardEsmLoader)) {
  throw new Error(
    'Missing packages/api/dist/esm-loader.js. Build the API package before creating the npm distribution.',
  );
}

if (!existsSync(resolve(dashboardAssets, 'index.html'))) {
  throw new Error(
    'Missing packages/dashboard/dist/index.html. Run "pnpm --filter @codegraph/dashboard build" first.',
  );
}

const packageManifest = readManifest('packages/npm-package/package.json');
const dependencyManifests = Object.fromEntries(
  [
    'packages/mcp-server/package.json',
    'packages/plugin-nlp/package.json',
    'packages/plugin-go/package.json',
    'packages/plugin-python/package.json',
    'packages/plugin-rust/package.json',
    'packages/plugin-typescript/package.json',
    'packages/plugin-languages/package.json',
    'packages/graph/package.json',
  ].map((path) => {
    const manifest = readManifest(path);
    if (typeof manifest.name !== 'string') {
      throw new TypeError(`${path} must define a package name`);
    }
    return [manifest.name, manifest];
  }),
);
const publishedManifest = createPublishedManifest({ packageManifest, dependencyManifests });
const externalPackages = [
  ...Object.keys(publishedManifest.dependencies),
  ...Object.keys(publishedManifest.optionalDependencies),
];

rmSync(outputDirectory, { recursive: true, force: true });
mkdirSync(resolve(outputDirectory, 'server'), { recursive: true });
mkdirSync(resolve(outputDirectory, 'bin'), { recursive: true });

// One split build: the MCP server and the dashboard server share almost all of
// their code (parsers, graph layer, plugins). Bundling them separately emitted
// that payload twice and roughly doubled the published package.
await build({
  entryPoints: {
    index: serverEntry,
    dashboard: dashboardServerEntry,
  },
  outdir: resolve(outputDirectory, 'server'),
  outExtension: { '.js': '.mjs' },
  bundle: true,
  splitting: true,
  platform: 'node',
  target: 'node20',
  format: 'esm',
  sourcemap: false,
  conditions: ['import', 'node'],
  banner: {
    js: 'import { createRequire as __bundleRequire } from "node:module"; const require = __bundleRequire(import.meta.url);',
  },
  external: externalPackages,
  logLevel: 'info',
});

cpSync(dashboardEsmLoader, resolve(outputDirectory, 'server', 'esm-loader.js'));

// The dashboard is served from <package>/dashboard, which is what
// resolveDashboardDir() looks for relative to the bundled server.
cpSync(dashboardAssets, resolve(outputDirectory, 'dashboard'), { recursive: true });

for (const binName of ['codegraph-mcp.mjs', 'codegraph-dashboard.mjs']) {
  const source = resolve(packageDirectory, 'bin', binName);
  const destination = resolve(outputDirectory, 'bin', binName);
  cpSync(source, destination);
  chmodSync(destination, 0o755);
}
cpSync(resolve(rootDirectory, 'LICENSE'), resolve(outputDirectory, 'LICENSE'));

writeFileSync(
  resolve(outputDirectory, 'package.json'),
  `${JSON.stringify(publishedManifest, null, 2)}\n`,
);
writeFileSync(
  resolve(outputDirectory, 'README.md'),
  `# CodeGraph MCP Server

Index code into a graph for MCP agents or explore it in the browser dashboard. Node.js 20 or newer is required.

## Agent-first with MCP

Add this configuration to an MCP client after the package is visible in the npm registry:

\`\`\`json
{
  "mcpServers": {
    "codegraph": {
      "command": "npx",
      "args": ["-y", "-p", "@codegraph/mcp", "codegraph-mcp"]
    }
  }
}
\`\`\`

On a fresh database, the \`codebase\` status action returns \`configured: false\` and \`setupRequired: true\`. Configure an absolute project path, then run a full reindex:

\`\`\`json
{"action":"configure","projectAction":"set","projects":["/absolute/path/to/project"]}
\`\`\`

\`\`\`json
{"action":"reindex","mode":"full","scope":"/absolute/path/to/project"}
\`\`\`

Configuration saves the project. Reindexing parses structure and finishes embeddings.

## Dashboard-first in a browser

Start the dashboard directly from this package:

\`\`\`bash
npx -y -p @codegraph/mcp codegraph-dashboard
\`\`\`

Open the URL printed by the process. A fresh database opens on setup. Confirm storage and embeddings, use Browse to choose a folder, then select Index project. The page shows download and indexing progress before opening the explorer.

## Platform and storage

| Platform | Storage | Prerequisites |
| --- | --- | --- |
| Linux x64 | Embedded FalkorDBLite | Node.js 20 or newer |
| macOS Apple silicon | Embedded FalkorDBLite | Node.js 20 or newer, \`brew install libomp openssl@3\` |
| macOS Intel | External FalkorDB | Node.js 20 or newer |
| Windows x64 | External FalkorDB | Node.js 20 or newer |
| Linux arm64 | External FalkorDB | Node.js 20 or newer |

For external FalkorDB, set \`CODEGRAPH_DRIVER=falkordb\` with \`FALKORDB_URL\`, or with \`FALKORDB_HOST\` and \`FALKORDB_PORT\`.

One database server runs per data directory; a second CodeGraph process attaches to it.

## Embeddings

| Provider | Model | Dimensions | Configuration |
| --- | --- | --- | --- |
| Local | \`nomic-ai/nomic-embed-text-v1.5\` | 768 | Default when no provider or provider key is set |
| Voyage | \`voyage-code-3\` | 1024 | \`CODEGRAPH_EMBEDDING_PROVIDER=voyage\` and \`VOYAGE_API_KEY\` |
| OpenRouter | \`openai/text-embedding-3-small\` | 1536 | \`CODEGRAPH_EMBEDDING_PROVIDER=openrouter\` and \`OPENROUTER_API_KEY\` |
| None | No model | 0 | \`CODEGRAPH_EMBEDDING_PROVIDER=none\` |

The first local run downloads approximately 132 MiB. The measured first-run download was 138,011,417 bytes (131.6 MiB). Progress is visible and the model is cached afterward. If the provider, model, or dimension changes, CodeGraph requires this remedy: \`Run an explicit re-embed migration or a full reindex before using the requested embedding profile.\`

## MCP tools

The public tools are \`analyze\`, \`codebase\`, \`knowledge\`, \`query\`, and \`search\`.

## Project links

- [Source and quickstart](https://github.com/Phoenixrr2113/codebase-graph#choose-how-to-start)
- [Configuration and environment variables](https://github.com/Phoenixrr2113/codebase-graph#configuration)
- [Issue tracker](https://github.com/Phoenixrr2113/codebase-graph/issues)
- [Web app](https://v0-landing-page-build-kappa-virid.vercel.app)

## Package maintainers

Create the complete, validated publishable tarball from the repository root:

\`\`\`bash
pnpm pack:npm
\`\`\`

Packing from \`packages/npm-package\` is intentionally blocked because that source
directory does not contain the staged server and dashboard payload.

The installed-tarball smoke verifies both binaries, all five MCP tools, setup-safe empty storage, Browse, indexing, persistence, shared embedded ownership, and the tarball hash. Registry resolution for the two \`npx\` entry paths is verified only after publication.

## License

MIT
`,
);

const bundleBytes = readFileSync(resolve(outputDirectory, 'server/index.mjs')).byteLength;
console.log(`Built @codegraph/mcp staging directory (${(bundleBytes / 1024 / 1024).toFixed(1)} MB bundle).`);
console.log('Canonical package command: pnpm pack:npm');
