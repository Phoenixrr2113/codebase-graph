#!/usr/bin/env node
/**
 * Build script for CodeGraph MCPB (Desktop Extension)
 *
 * Uses esbuild (via CLI) to bundle the MCP server into a single file,
 * with tree-sitter native modules kept external and copied separately.
 */

import { cpSync, mkdirSync, rmSync, existsSync, readdirSync, readFileSync, writeFileSync, statSync, symlinkSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execSync } from 'node:child_process';
import { build } from 'esbuild';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '../..');
const OUT = resolve(__dirname, 'dist');
const SERVER_DIR = resolve(OUT, 'server');

// Clean
if (existsSync(OUT)) rmSync(OUT, { recursive: true });
mkdirSync(SERVER_DIR, { recursive: true });

// Find tree-sitter grammars in pnpm's node_modules (may be symlinked)
function findPnpmPackage(name) {
  // Direct path (hoisted or symlinked)
  const direct = resolve(ROOT, 'node_modules', name);
  if (existsSync(direct)) return direct;
  // Check inside core's node_modules
  const core = resolve(ROOT, 'packages/core/node_modules', name);
  if (existsSync(core)) return core;
  return null;
}

// Collect all tree-sitter packages
const allNodeModules = resolve(ROOT, 'node_modules');
const treeSitterGrammars = [];

// Check top-level node_modules for tree-sitter packages
if (existsSync(allNodeModules)) {
  for (const name of readdirSync(allNodeModules)) {
    if (name.startsWith('tree-sitter-')) {
      treeSitterGrammars.push(name);
    }
  }
}

// Also check pnpm virtual store
const pnpmStore = resolve(allNodeModules, '.pnpm');
if (existsSync(pnpmStore)) {
  for (const name of readdirSync(pnpmStore)) {
    if (name.startsWith('tree-sitter-') && !name.startsWith('.')) {
      const baseName = name.split('@')[0];
      if (baseName && !treeSitterGrammars.includes(baseName)) {
        treeSitterGrammars.push(baseName);
      }
    }
  }
}

const externalPackages = [
  'tree-sitter',
  ...treeSitterGrammars,
  '@huggingface/transformers',
  'onnxruntime-node',
  'falkordblite',
  // MCP SDK has wildcard exports that esbuild can't resolve: we externalize
  // and copy it, then patch the imports to add .js extensions post-build
  '@modelcontextprotocol/sdk',
  '@modelcontextprotocol/sdk/*',
];

console.log(`Found ${treeSitterGrammars.length} tree-sitter grammars`);
console.log(`Bundling with ${externalPackages.length} external packages...`);

console.log('Running esbuild...');
await build({
  entryPoints: [resolve(ROOT, 'packages/mcp-server/dist/index.js')],
  outfile: resolve(SERVER_DIR, 'index.mjs'),
  bundle: true,
  platform: 'node',
  target: 'node20',
  format: 'esm',
  logLevel: 'info',
  conditions: ['import', 'node'],
  resolveExtensions: ['.js', '.mjs', '.ts', '.tsx', '.json'],
  banner: {
    js: 'import { createRequire as __bundleRequire } from "node:module"; const require = __bundleRequire(import.meta.url);',
  },
  external: externalPackages,
});

console.log('Bundle created. Installing MCP SDK dependencies...');

// Install MCP SDK + all transitive deps FIRST (before copying native modules)
const sdkPkg = { dependencies: { '@modelcontextprotocol/sdk': '^1.0.0' } };
writeFileSync(resolve(SERVER_DIR, 'package.json'), JSON.stringify(sdkPkg));
execSync('npm install --production --no-optional --no-audit --no-fund 2>&1', {
  cwd: SERVER_DIR,
  stdio: 'pipe',
});
rmSync(resolve(SERVER_DIR, 'package.json'), { force: true });
rmSync(resolve(SERVER_DIR, 'package-lock.json'), { force: true });

console.log('Copying native modules...');

// Copy tree-sitter and grammar native modules ON TOP of the installed deps
const nmDest = resolve(SERVER_DIR, 'node_modules');
mkdirSync(nmDest, { recursive: true });

function resolveRealPath(pkgName) {
  // pnpm uses symlinks: resolve through them
  const candidates = [
    resolve(ROOT, 'node_modules', pkgName),
    resolve(ROOT, 'packages/core/node_modules', pkgName),
    resolve(ROOT, 'packages/mcp-server/node_modules', pkgName),
    resolve(ROOT, 'packages/plugin-typescript/node_modules', pkgName),
    resolve(ROOT, 'packages/plugin-languages/node_modules', pkgName),
    resolve(ROOT, 'packages/plugin-go/node_modules', pkgName),
    resolve(ROOT, 'packages/plugin-python/node_modules', pkgName),
    resolve(ROOT, 'packages/plugin-rust/node_modules', pkgName),
  ];
  for (const c of candidates) {
    try {
      if (existsSync(c)) return c;
    } catch {}
  }
  // Fallback: search pnpm virtual store
  const pnpmStore = resolve(ROOT, 'node_modules/.pnpm');
  if (existsSync(pnpmStore)) {
    const safeName = pkgName.replace(/\//g, '+');
    for (const dir of readdirSync(pnpmStore)) {
      if (dir.startsWith(safeName + '@')) {
        const candidate = resolve(pnpmStore, dir, 'node_modules', pkgName);
        if (existsSync(candidate)) return candidate;
      }
    }
  }
  return null;
}

// tree-sitter-cli is a CLI tool, not a grammar: don't bundle it
const skipPackages = new Set(['tree-sitter-cli']);

let copiedCount = 0;
for (const pkg of ['tree-sitter', ...treeSitterGrammars.filter(g => !skipPackages.has(g))]) {
  const src = resolveRealPath(pkg);
  if (src) {
    const dest = resolve(nmDest, pkg);
    cpSync(src, dest, { recursive: true, dereference: true });
    // Remove unnecessary files to reduce size
    for (const unnecessary of ['src', 'test', 'tests', '.github', 'binding.gyp', 'Cargo.toml', 'Cargo.lock', 'grammar.js']) {
      const p = resolve(dest, unnecessary);
      if (existsSync(p)) rmSync(p, { recursive: true, force: true });
    }
    copiedCount++;
  } else {
    console.warn(`⚠ ${pkg} not found, skipping`);
  }
}

// Copy MCP SDK and patch wildcard exports
const mcpSdkSrc = resolveRealPath('@modelcontextprotocol/sdk');
if (mcpSdkSrc) {
  mkdirSync(resolve(nmDest, '@modelcontextprotocol'), { recursive: true });
  cpSync(mcpSdkSrc, resolve(nmDest, '@modelcontextprotocol/sdk'), { recursive: true, dereference: true });
  copiedCount++;
}

// Patch MCP SDK imports in the bundle to add .js extensions for wildcard exports.
// The SDK has explicit exports (./server, ./client, ./types, etc.) that Node resolves
// correctly, but wildcard "./*" exports need .js suffix for Node ESM resolution.
// Explicit export entries: client, server, validation, validation/ajv, validation/cfworker,
// experimental, experimental/tasks: these DON'T need patching.
const bundlePath = resolve(SERVER_DIR, 'index.mjs');
let bundleContent = readFileSync(bundlePath, 'utf-8');
const explicitExports = new Set([
  'client', 'server', 'validation', 'validation/ajv',
  'validation/cfworker', 'experimental', 'experimental/tasks',
]);
bundleContent = bundleContent.replace(
  /from\s+"@modelcontextprotocol\/sdk\/([^"]+)"/g,
  (match, subpath) => {
    if (subpath.endsWith('.js')) return match;
    if (explicitExports.has(subpath)) return match; // Has explicit export entry
    return `from "@modelcontextprotocol/sdk/${subpath}.js"`;
  }
);
writeFileSync(bundlePath, bundleContent);

// MCP SDK already installed above: just copy if not present
const mcpSdkDest = resolve(nmDest, '@modelcontextprotocol/sdk');
if (!existsSync(mcpSdkDest)) {
  const mcpSdkSrc = resolveRealPath('@modelcontextprotocol/sdk');
  if (mcpSdkSrc) {
    mkdirSync(resolve(nmDest, '@modelcontextprotocol'), { recursive: true });
    cpSync(mcpSdkSrc, mcpSdkDest, { recursive: true, dereference: true });
  }
}

// Copy runtime deps needed by tree-sitter
for (const dep of ['node-addon-api', 'prebuild-install', 'node-gyp-build']) {
  const src = resolveRealPath(dep);
  if (src) {
    cpSync(src, resolve(nmDest, dep), { recursive: true, dereference: true });
  }
}

// Generate platform-local metadata from the canonical npm package version.
const npmPackage = JSON.parse(
  readFileSync(resolve(ROOT, 'packages/npm-package/package.json'), 'utf8'),
);
const manifest = JSON.parse(readFileSync(resolve(__dirname, 'manifest.json'), 'utf8'));
manifest.version = npmPackage.version;
manifest.author.url = 'https://github.com/Phoenixrr2113';
manifest.repository = {
  type: 'git',
  url: 'https://github.com/Phoenixrr2113/codebase-graph',
};
manifest.homepage = 'https://v0-landing-page-build-kappa-virid.vercel.app';
manifest.long_description = 'CodeGraph indexes source code into a graph and exposes search, codebase, knowledge, and Cypher tools through MCP. Offline structural search works without API keys by setting the embedding provider to none.';
delete manifest.user_config.voyage_api_key;
delete manifest.user_config.jina_api_key;
delete manifest.server.mcp_config.env.VOYAGE_API_KEY;
delete manifest.server.mcp_config.env.JINA_API_KEY;
manifest.server.mcp_config.env.CODEGRAPH_EMBEDDING_PROVIDER = 'none';
manifest.compatibility.platforms = [process.platform];
writeFileSync(resolve(OUT, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
writeFileSync(resolve(OUT, 'package.json'), JSON.stringify({
  name: 'codegraph-mcpb',
  version: npmPackage.version,
  type: 'module',
  private: true,
}, null, 2));
cpSync(resolve(__dirname, 'README.md'), resolve(OUT, 'README.md'));

// Copy icon if it exists
const iconSrc = resolve(__dirname, 'icon.png');
if (existsSync(iconSrc)) {
  cpSync(iconSrc, resolve(OUT, 'icon.png'));
} else {
  console.warn('⚠ No icon.png found: add one for the extension listing');
}

// Calculate sizes
const bundleSize = readFileSync(resolve(SERVER_DIR, 'index.mjs')).length;
const totalNativeSize = execSync(`du -sh ${nmDest} 2>/dev/null || echo "unknown"`)
  .toString().trim().split('\t')[0];

console.log(`\n✅ MCPB build complete!`);
console.log(`   Bundle: ${(bundleSize / 1024 / 1024).toFixed(1)} MB`);
console.log(`   Native modules: ${copiedCount} packages (${totalNativeSize})`);
console.log(`   Output: ${OUT}`);
console.log(`\nTo pack: cd ${OUT} && mcpb pack`);
