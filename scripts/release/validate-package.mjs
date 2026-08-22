#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import {
  chmod,
  lstat,
  mkdir,
  readFile,
  readdir,
  rm,
  writeFile,
} from 'node:fs/promises';
import { dirname, extname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const canonicalRepository = 'git+https://github.com/Phoenixrr2113/codebase-graph.git';
const canonicalHomepage = 'https://v0-landing-page-build-kappa-virid.vercel.app';
const canonicalIssues = 'https://github.com/Phoenixrr2113/codebase-graph/issues';
const maximumPackedBytes = 15 * 1024 * 1024;
const releaseDirectory = dirname(fileURLToPath(import.meta.url));
const rootDirectory = resolve(releaseDirectory, '../..');

function requireRecord(value, label, violations) {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    violations.push(`${label} must be an object`);
    return {};
  }
  return value;
}

function readRepositoryUrl(manifest, violations) {
  const repository = requireRecord(manifest.repository, 'package.json repository', violations);
  return typeof repository.url === 'string' ? repository.url : undefined;
}

async function collectEntries(root, current, entries, violations) {
  for (const entry of await readdir(current, { withFileTypes: true })) {
    const path = join(current, entry.name);
    const relativePath = relative(root, path);
    if (entry.isSymbolicLink()) {
      violations.push(`symbolic links are not allowed: ${relativePath}`);
      continue;
    }
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules') {
        violations.push(`node_modules directory is not allowed: ${relativePath}`);
      }
      await collectEntries(root, path, entries, violations);
      continue;
    }
    entries.push({ path, relativePath, stats: await lstat(path) });
  }
}

function findWorkspaceRange(value, location = 'package.json') {
  if (typeof value === 'string') {
    return value.startsWith('workspace:') ? location : undefined;
  }
  if (Array.isArray(value)) {
    for (const [index, item] of value.entries()) {
      const found = findWorkspaceRange(item, `${location}[${index}]`);
      if (found) return found;
    }
    return undefined;
  }
  if (typeof value === 'object' && value !== null) {
    for (const [key, item] of Object.entries(value)) {
      const found = findWorkspaceRange(item, `${location}.${key}`);
      if (found) return found;
    }
  }
  return undefined;
}

export async function validatePackageDirectory(directoryUrl) {
  const directory = directoryUrl instanceof URL ? fileURLToPath(directoryUrl) : resolve(directoryUrl);
  const violations = [];
  const entries = [];

  try {
    const directoryStats = await lstat(directory);
    if (!directoryStats.isDirectory()) {
      throw new Error('path is not a directory');
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Package staging directory is unavailable: ${message}`);
  }

  await collectEntries(directory, directory, entries, violations);
  const paths = new Set(entries.map((entry) => entry.relativePath));
  for (const requiredPath of [
    'package.json',
    'LICENSE',
    'README.md',
    join('bin', 'codegraph-mcp.mjs'),
    join('server', 'index.mjs'),
    join('server', 'esm-loader.js'),
  ]) {
    if (!paths.has(requiredPath)) {
      violations.push(`required file is missing: ${requiredPath}`);
    }
  }

  let manifest = {};
  try {
    manifest = requireRecord(
      JSON.parse(await readFile(join(directory, 'package.json'), 'utf8')),
      'package.json',
      violations,
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    violations.push(`package.json is invalid: ${message}`);
  }

  const workspaceLocation = findWorkspaceRange(manifest);
  if (workspaceLocation) {
    violations.push(`workspace: range found at ${workspaceLocation}`);
  }
  if (manifest.name !== 'codegraph-mcp') {
    violations.push('package.json name must be codegraph-mcp');
  }
  if (typeof manifest.version !== 'string' || manifest.version.length === 0) {
    violations.push('package.json version must be a non-empty string');
  }
  if (manifest.license !== 'MIT') {
    violations.push('package.json license must be MIT');
  }
  if (readRepositoryUrl(manifest, violations) !== canonicalRepository) {
    violations.push(`package.json repository must be ${canonicalRepository}`);
  }
  if (manifest.homepage !== canonicalHomepage) {
    violations.push(`package.json homepage must be ${canonicalHomepage}`);
  }
  const bugs = requireRecord(manifest.bugs, 'package.json bugs', violations);
  if (bugs.url !== canonicalIssues) {
    violations.push(`package.json bugs.url must be ${canonicalIssues}`);
  }
  const engines = requireRecord(manifest.engines, 'package.json engines', violations);
  if (engines.node !== '>=20.0.0') {
    violations.push('package.json engines.node must be >=20.0.0');
  }
  const publishConfig = requireRecord(
    manifest.publishConfig,
    'package.json publishConfig',
    violations,
  );
  if (publishConfig.access !== 'public') {
    violations.push('package.json publishConfig.access must be public');
  }
  if (manifest.scripts !== undefined) {
    violations.push('published package must not contain lifecycle scripts');
  }

  const bin = requireRecord(manifest.bin, 'package.json bin', violations);
  for (const [binName, expectedPath] of [
    ['codegraph-mcp', 'bin/codegraph-mcp.mjs'],
    ['codegraph-dashboard', 'bin/codegraph-dashboard.mjs'],
  ]) {
    const binRelativePath = bin[binName];
    if (binRelativePath !== expectedPath) {
      violations.push(`package.json bin must map ${binName} to ${expectedPath}`);
      continue;
    }
    try {
      const binStats = await lstat(join(directory, binRelativePath));
      if ((binStats.mode & 0o111) === 0) {
        violations.push(`${binName} bin file must be executable`);
      }
    } catch {
      violations.push(`${binName} bin file is missing`);
    }
  }

  // The dashboard binary is useless without the built UI it serves.
  try {
    await lstat(join(directory, 'dashboard/index.html'));
  } catch {
    violations.push('dashboard/index.html is missing from the published package');
  }

  try {
    const license = await readFile(join(directory, 'LICENSE'), 'utf8');
    if (!license.startsWith('MIT License')) {
      violations.push('LICENSE must contain the MIT license text');
    }
  } catch {
    // Missing LICENSE is already reported above.
  }

  for (const entry of entries) {
    if (entry.relativePath.split(sep).includes('node_modules')) continue;
    if (extname(entry.relativePath) === '.node') {
      violations.push(`native .node file is not allowed: ${entry.relativePath}`);
    }
    if (extname(entry.relativePath) === '.map') {
      violations.push(`source map is not allowed: ${entry.relativePath}`);
    }
    if (entry.relativePath === '.env' || entry.relativePath === '.npmrc') {
      violations.push(`credential-bearing file is not allowed: ${entry.relativePath}`);
    }
    if (/\.(?:mjs|js|json|md|txt|map)$/i.test(entry.relativePath)) {
      const content = await readFile(entry.path, 'utf8');
      if (content.includes(rootDirectory)) {
        violations.push(`absolute repository path found in ${entry.relativePath}`);
      }
    }
  }

  if (violations.length > 0) {
    throw new Error(`Package validation failed:\n- ${violations.join('\n- ')}`);
  }

  return {
    name: manifest.name,
    version: manifest.version,
    fileCount: entries.length,
  };
}

export function validatePackReport(report) {
  const violations = [];
  if (!Array.isArray(report) || report.length !== 1) {
    throw new Error('npm pack report must contain exactly one package');
  }
  const item = requireRecord(report[0], 'npm pack report item', violations);
  const files = Array.isArray(item.files) ? item.files : [];
  if (item.name !== 'codegraph-mcp') {
    violations.push('packed package name must be codegraph-mcp');
  }
  if (typeof item.version !== 'string' || item.version.length === 0) {
    violations.push('packed package version is missing');
  }
  if (typeof item.filename !== 'string' || item.filename.length === 0) {
    violations.push('packed package filename is missing');
  }
  if (typeof item.size !== 'number' || !Number.isFinite(item.size)) {
    violations.push('packed package size is invalid');
  } else if (item.size > maximumPackedBytes) {
    violations.push('packed package exceeds the 15 MB compressed size budget');
  }
  if (typeof item.unpackedSize !== 'number' || !Number.isFinite(item.unpackedSize)) {
    violations.push('packed package unpacked size is invalid');
  }
  if (typeof item.entryCount !== 'number' || !Number.isInteger(item.entryCount)) {
    violations.push('packed package entry count is invalid');
  }
  for (const file of files) {
    const fileRecord = requireRecord(file, 'npm pack file', violations);
    const path = typeof fileRecord.path === 'string' ? fileRecord.path : '';
    if (path.split('/').includes('node_modules')) violations.push(`packed node_modules path: ${path}`);
    if (path.endsWith('.node')) violations.push(`packed native binary: ${path}`);
    if (path.endsWith('.map')) violations.push(`packed source map: ${path}`);
  }
  if (violations.length > 0) {
    throw new Error(`npm pack validation failed:\n- ${violations.join('\n- ')}`);
  }
  return {
    name: item.name,
    version: item.version,
    filename: item.filename,
    fileCount: item.entryCount,
    packedSize: item.size,
    unpackedSize: item.unpackedSize,
  };
}

async function runCli() {
  const stagingArgument = process.argv[2];
  if (!stagingArgument) {
    throw new Error('Usage: node scripts/release/validate-package.mjs <staging-directory>');
  }
  const stagingDirectory = resolve(stagingArgument);
  const directoryResult = await validatePackageDirectory(pathToFileURL(stagingDirectory));
  const artifactDirectory = resolve(rootDirectory, 'tmp/release');
  await rm(artifactDirectory, { recursive: true, force: true });
  await mkdir(artifactDirectory, { recursive: true });

  const pack = spawnSync(
    'npm',
    ['pack', '--json', '--pack-destination', artifactDirectory, stagingDirectory],
    { encoding: 'utf8', cwd: rootDirectory },
  );
  if (pack.status !== 0) {
    throw new Error(`npm pack failed: ${pack.stderr.trim() || 'unknown error'}`);
  }
  let report;
  try {
    report = JSON.parse(pack.stdout);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`npm pack returned invalid JSON: ${message}`);
  }
  const packResult = validatePackReport(report);
  if (packResult.version !== directoryResult.version) {
    throw new Error('staged and packed package versions do not match');
  }
  const tarballPath = resolve(artifactDirectory, packResult.filename);
  const resultPath = resolve(artifactDirectory, 'package-result.json');
  await writeFile(
    resultPath,
    `${JSON.stringify({ ...packResult, tarballPath }, null, 2)}\n`,
    { mode: 0o600 },
  );
  await chmod(tarballPath, 0o644);
  process.stdout.write(`${JSON.stringify({ ...packResult, tarballPath, resultPath })}\n`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  runCli().catch((error) => {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`${message}\n`);
    process.exitCode = 1;
  });
}
