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

await build({
  entryPoints: [serverEntry],
  outfile: resolve(outputDirectory, 'server/index.mjs'),
  bundle: true,
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

const binSource = resolve(packageDirectory, 'bin/codegraph-mcp.mjs');
const binDestination = resolve(outputDirectory, 'bin/codegraph-mcp.mjs');
cpSync(binSource, binDestination);
chmodSync(binDestination, 0o755);
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

## Offline start

\`\`\`bash
CODEGRAPH_EMBEDDING_PROVIDER=none codegraph-mcp
\`\`\`

This structural-search mode requires no API keys. CodeGraph can use embedded FalkorDBLite or an external FalkorDB service.

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
