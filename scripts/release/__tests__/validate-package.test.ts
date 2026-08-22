import { afterEach, describe, expect, it } from 'vitest';
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  validatePackageDirectory,
  validatePackReport,
} from '../validate-package.mjs';

const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

function createValidFixture(): string {
  const directory = mkdtempSync(join(tmpdir(), 'codegraph-package-'));
  temporaryDirectories.push(directory);
  mkdirSync(join(directory, 'bin'));
  mkdirSync(join(directory, 'server'));
  writeFileSync(join(directory, 'bin', 'codegraph-mcp.mjs'), '#!/usr/bin/env node\n');
  chmodSync(join(directory, 'bin', 'codegraph-mcp.mjs'), 0o755);
  writeFileSync(join(directory, 'bin', 'codegraph-dashboard.mjs'), '#!/usr/bin/env node\n');
  chmodSync(join(directory, 'bin', 'codegraph-dashboard.mjs'), 0o755);
  mkdirSync(join(directory, 'dashboard'));
  writeFileSync(join(directory, 'dashboard', 'index.html'), '<!doctype html><div id="root"></div>\n');
  writeFileSync(join(directory, 'server', 'index.mjs'), 'export {};\n');
  writeFileSync(join(directory, 'server', 'esm-loader.js'), 'export async function resolve() {}\n');
  writeFileSync(join(directory, 'LICENSE'), 'MIT License\n');
  writeFileSync(join(directory, 'README.md'), '# CodeGraph\n');
  writeFileSync(join(directory, 'package.json'), JSON.stringify({
    name: 'codegraph-mcp',
    version: '0.1.0',
    license: 'MIT',
    repository: {
      type: 'git',
      url: 'git+https://github.com/Phoenixrr2113/codebase-graph.git',
    },
    homepage: 'https://v0-landing-page-build-kappa-virid.vercel.app',
    bugs: { url: 'https://github.com/Phoenixrr2113/codebase-graph/issues' },
    engines: { node: '>=20.0.0' },
    publishConfig: { access: 'public' },
    bin: {
      'codegraph-mcp': 'bin/codegraph-mcp.mjs',
      'codegraph-dashboard': 'bin/codegraph-dashboard.mjs',
    },
    dependencies: { 'tree-sitter': '^0.22.4' },
  }));
  return directory;
}

describe('validatePackageDirectory', () => {
  it('accepts a valid staged package', async () => {
    const directory = createValidFixture();

    await expect(validatePackageDirectory(pathToFileURL(directory))).resolves.toMatchObject({
      name: 'codegraph-mcp',
      version: '0.1.0',
      fileCount: 8,
    });
  });

  it('reports workspace ranges', async () => {
    const directory = createValidFixture();
    const manifestPath = join(directory, 'package.json');
    const manifest = JSON.parse(await import('node:fs/promises').then((fs) => fs.readFile(manifestPath, 'utf8')));
    manifest.dependencies.internal = 'workspace:*';
    writeFileSync(manifestPath, JSON.stringify(manifest));

    await expect(validatePackageDirectory(pathToFileURL(directory))).rejects.toThrow('workspace:');
  });

  it('reports a missing runtime ESM loader', async () => {
    const directory = createValidFixture();
    rmSync(join(directory, 'server', 'esm-loader.js'));

    await expect(validatePackageDirectory(pathToFileURL(directory))).rejects.toThrow(
      'server/esm-loader.js',
    );
  });

  it('reports node_modules directories and native binaries', async () => {
    const directory = createValidFixture();
    mkdirSync(join(directory, 'node_modules'));
    writeFileSync(join(directory, 'server', 'binding.node'), 'binary');

    await expect(validatePackageDirectory(pathToFileURL(directory))).rejects.toThrow(/node_modules[\s\S]*\.node/);
  });

  it('reports source maps containing absolute repository paths', async () => {
    const directory = createValidFixture();
    writeFileSync(
      join(directory, 'server', 'index.mjs.map'),
      JSON.stringify({ sources: [join(process.cwd(), 'packages/mcp-server/src/index.ts')] }),
    );

    await expect(validatePackageDirectory(pathToFileURL(directory))).rejects.toThrow(/source map|absolute/i);
  });

  it('reports a missing executable bit on the CLI', async () => {
    const directory = createValidFixture();
    chmodSync(join(directory, 'bin', 'codegraph-mcp.mjs'), 0o644);

    await expect(validatePackageDirectory(pathToFileURL(directory))).rejects.toThrow('executable');
  });

  it('reports incorrect license and repository metadata together', async () => {
    const directory = createValidFixture();
    const manifestPath = join(directory, 'package.json');
    const manifest = JSON.parse(await import('node:fs/promises').then((fs) => fs.readFile(manifestPath, 'utf8')));
    manifest.license = 'UNLICENSED';
    manifest.repository.url = 'https://example.com/wrong.git';
    writeFileSync(manifestPath, JSON.stringify(manifest));

    await expect(validatePackageDirectory(pathToFileURL(directory))).rejects.toThrow(/MIT[\s\S]*repository/);
  });

  it('reports incorrect public package endpoints and constraints', async () => {
    const directory = createValidFixture();
    const manifestPath = join(directory, 'package.json');
    const manifest = JSON.parse(await import('node:fs/promises').then((fs) => fs.readFile(manifestPath, 'utf8')));
    manifest.homepage = 'https://example.com';
    manifest.bugs.url = 'https://example.com/issues';
    manifest.engines.node = '>=18';
    manifest.publishConfig.access = 'restricted';
    writeFileSync(manifestPath, JSON.stringify(manifest));

    await expect(validatePackageDirectory(pathToFileURL(directory))).rejects.toThrow(
      /homepage[\s\S]*bugs[\s\S]*engines[\s\S]*publishConfig/,
    );
  });
});

describe('validatePackReport', () => {
  it('returns package and size metadata for a valid npm report', () => {
    expect(validatePackReport([{
      name: 'codegraph-mcp',
      version: '0.1.0',
      filename: 'codegraph-mcp-0.1.0.tgz',
      size: 1024,
      unpackedSize: 4096,
      entryCount: 5,
      files: [{ path: 'package/bin/codegraph-mcp.mjs', size: 20, mode: 493 }],
    }])).toEqual({
      name: 'codegraph-mcp',
      version: '0.1.0',
      filename: 'codegraph-mcp-0.1.0.tgz',
      fileCount: 5,
      packedSize: 1024,
      unpackedSize: 4096,
    });
  });

  it('rejects packed artifacts over 15 MB', () => {
    expect(() => validatePackReport([{
      name: 'codegraph-mcp',
      version: '0.1.0',
      filename: 'codegraph-mcp-0.1.0.tgz',
      size: (15 * 1024 * 1024) + 1,
      unpackedSize: 20 * 1024 * 1024,
      entryCount: 5,
      files: [],
    }])).toThrow('15 MB');
  });
});
