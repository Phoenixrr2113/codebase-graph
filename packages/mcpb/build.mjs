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
  // MCP SDK has wildcard exports that esbuild can't resolve — we externalize
  // and copy it, then patch the imports to add .js extensions post-build
  '@modelcontextprotocol/sdk',
  '@modelcontextprotocol/sdk/*',
];

console.log(`Found ${treeSitterGrammars.length} tree-sitter grammars`);
console.log(`Bundling with ${externalPackages.length} external packages...`);

// Build external args for esbuild CLI
const externalArgs = externalPackages.map(p => `--external:${p}`).join(' ');

// Run esbuild via CLI — use the native binary from pnpm's store
const esbuildBin = resolve(ROOT, 'node_modules/.pnpm/@esbuild+darwin-arm64@0.27.4/node_modules/@esbuild/darwin-arm64/bin/esbuild');
const esbuildCmd = [
  esbuildBin,
  resolve(ROOT, 'packages/mcp-server/dist/index.js'),
  '--bundle',
  '--platform=node',
  '--target=node20',
  '--format=esm',
  `--outfile=${resolve(SERVER_DIR, 'index.mjs')}`,
  '--log-level=info',
  '--conditions=import,node',
  '--resolve-extensions=.js,.mjs,.ts,.tsx,.json',
  '--banner:js=\'import { createRequire as __bundleRequire } from "module"; const require = __bundleRequire(import.meta.url);\'',
  externalArgs,
].join(' ');

console.log('Running esbuild...');
execSync(esbuildCmd, { stdio: 'inherit', cwd: ROOT });

console.log('Bundle created. Copying native modules...');

// Copy tree-sitter and grammar native modules
const nmDest = resolve(SERVER_DIR, 'node_modules');
mkdirSync(nmDest, { recursive: true });

function resolveRealPath(pkgName) {
  // pnpm uses symlinks — resolve through them
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

// tree-sitter-cli is a CLI tool, not a grammar — don't bundle it
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
// experimental, experimental/tasks — these DON'T need patching.
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

// Copy runtime deps needed by tree-sitter
for (const dep of ['node-addon-api', 'prebuild-install', 'node-gyp-build']) {
  const src = resolveRealPath(dep);
  if (src) {
    cpSync(src, resolve(nmDest, dep), { recursive: true, dereference: true });
  }
}

// Copy manifest.json to dist root
cpSync(resolve(__dirname, 'manifest.json'), resolve(OUT, 'manifest.json'));

// Copy icon if it exists
const iconSrc = resolve(__dirname, 'icon.png');
if (existsSync(iconSrc)) {
  cpSync(iconSrc, resolve(OUT, 'icon.png'));
} else {
  console.warn('⚠ No icon.png found — add one for the extension listing');
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
