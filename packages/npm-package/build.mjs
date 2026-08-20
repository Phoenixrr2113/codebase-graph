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

Index code into a graph and expose search, knowledge, codebase, and Cypher tools through the Model Context Protocol.

## Install

\`\`\`bash
npm install --global codegraph-mcp
\`\`\`

Then configure an MCP client to run \`codegraph-mcp\`. The server uses stdio and keeps logs on stderr.

## Dashboard

This package also installs \`codegraph-dashboard\`, a browser UI for exploring the
graph: force, tree, and ring views, semantic and Cypher search, a source viewer,
and an operations tab for indexing and embedding coverage.

\`\`\`bash
npx codegraph-dashboard
\`\`\`

It serves the UI and the REST API on http://localhost:3001. Set \`API_PORT\` to
change the port. The dashboard is optional: the MCP server neither starts it nor
depends on it.

## Offline start

\`\`\`bash
CODEGRAPH_EMBEDDING_PROVIDER=none codegraph-mcp
\`\`\`

This structural-search mode requires no API keys. Embedded FalkorDBLite is available on Linux x64. Apple silicon macOS also requires Homebrew \`libomp\` and \`openssl@3\`; CodeGraph falls back to external FalkorDB when they are absent. Other platforms require an external FalkorDB service.

## Project links

- [Source and quickstart](https://github.com/Phoenixrr2113/codebase-graph#install-from-source)
- [MCP client setup](https://github.com/Phoenixrr2113/codebase-graph#use-with-an-mcp-client)
- [Configuration and environment variables](https://github.com/Phoenixrr2113/codebase-graph#configuration)
- [Issue tracker](https://github.com/Phoenixrr2113/codebase-graph/issues)
- [Web app](https://v0-landing-page-build-kappa-virid.vercel.app)

## License

MIT
`,
);

const bundleBytes = readFileSync(resolve(outputDirectory, 'server/index.mjs')).byteLength;
console.log(`Built codegraph-mcp staging directory (${(bundleBytes / 1024 / 1024).toFixed(1)} MB bundle).`);
