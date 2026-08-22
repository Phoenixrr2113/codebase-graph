import { describe, expect, it } from 'vitest';
import { createPublishedManifest } from '../lib/package-metadata.mjs';
import { canonicalPackCommand, rejectSourcePackagePack } from '../guard-pack.mjs';

const packageManifest = {
  name: 'codegraph-mcp',
  version: '0.1.0',
  description: 'CodeGraph MCP Server',
  type: 'module',
  bin: { 'codegraph-mcp': 'bin/codegraph-mcp.mjs' },
  keywords: ['mcp', 'code-search'],
  author: { name: 'Randy Wilson' },
  license: 'MIT',
  homepage: 'https://v0-landing-page-build-kappa-virid.vercel.app',
  repository: {
    type: 'git',
    url: 'git+https://github.com/Phoenixrr2113/codebase-graph.git',
  },
  bugs: { url: 'https://github.com/Phoenixrr2113/codebase-graph/issues' },
  publishConfig: { access: 'public', provenance: true },
  engines: { node: '>=20.0.0' },
  scripts: { build: 'node build.mjs', postinstall: 'node postinstall.mjs' },
};

const dependencyManifests = {
  '@codegraph/mcp-server': {
    name: '@codegraph/mcp-server',
    dependencies: { '@modelcontextprotocol/sdk': '^1.30.0' },
  },
  '@codegraph/plugin-nlp': {
    name: '@codegraph/plugin-nlp',
    dependencies: { '@huggingface/transformers': '^3.8.1' },
  },
  '@codegraph/plugin-go': {
    name: '@codegraph/plugin-go',
    dependencies: { 'tree-sitter': '^0.22.4', 'tree-sitter-go': '^0.23.4' },
  },
  '@codegraph/plugin-python': {
    name: '@codegraph/plugin-python',
    dependencies: { 'tree-sitter-python': '^0.21.0' },
  },
  '@codegraph/plugin-rust': {
    name: '@codegraph/plugin-rust',
    dependencies: { 'tree-sitter-rust': '0.23.1' },
  },
  '@codegraph/plugin-typescript': {
    name: '@codegraph/plugin-typescript',
    dependencies: { 'tree-sitter-typescript': '^0.23.2' },
  },
  '@codegraph/plugin-languages': {
    name: '@codegraph/plugin-languages',
    dependencies: {
      'tree-sitter-c-sharp': '^0.21.3',
      'tree-sitter-java': '^0.23.5',
      'tree-sitter-php': '^0.23.12',
    },
    optionalDependencies: { 'tree-sitter-bash': '^0.23.3' },
  },
  '@codegraph/graph': {
    name: '@codegraph/graph',
    devDependencies: { falkordblite: '^0.2.0' },
    optionalDependencies: {
      '@falkordblite/darwin-arm64': '8.2.3-falkordb.4.16.3',
      '@falkordblite/linux-x64': '8.2.3-falkordb.4.16.3',
    },
  },
};

describe('createPublishedManifest', () => {
  it('preserves canonical public metadata and removes build hooks', () => {
    const manifest = createPublishedManifest({ packageManifest, dependencyManifests });

    expect(manifest).toMatchObject({
      name: 'codegraph-mcp',
      version: '0.1.0',
      description: 'CodeGraph MCP Server',
      license: 'MIT',
      homepage: packageManifest.homepage,
      repository: packageManifest.repository,
      bugs: packageManifest.bugs,
      publishConfig: { access: 'public' },
      bin: { 'codegraph-mcp': 'bin/codegraph-mcp.mjs' },
      engines: packageManifest.engines,
      keywords: packageManifest.keywords,
    });
    expect(manifest.scripts).toBeUndefined();
    expect(manifest.publishConfig).not.toHaveProperty('provenance');
  });

  it('publishes runtime and native dependencies without workspace ranges', () => {
    const manifest = createPublishedManifest({ packageManifest, dependencyManifests });

    expect(manifest.dependencies).toMatchObject({
      '@huggingface/transformers': '^3.8.1',
      '@modelcontextprotocol/sdk': '^1.30.0',
      'tree-sitter': '^0.22.4',
      'tree-sitter-go': '^0.23.4',
      'tree-sitter-python': '^0.21.0',
      'tree-sitter-rust': '0.23.1',
      'tree-sitter-typescript': '^0.23.2',
      'tree-sitter-c-sharp': '^0.21.3',
      'tree-sitter-java': '^0.23.5',
      'tree-sitter-php': '^0.23.12',
    });
    expect(manifest.optionalDependencies).toMatchObject({
      '@falkordblite/darwin-arm64': '8.2.3-falkordb.4.16.3',
      '@falkordblite/linux-x64': '8.2.3-falkordb.4.16.3',
      falkordblite: '^0.2.0',
      'tree-sitter-bash': '^0.23.3',
    });
    expect(JSON.stringify(manifest)).not.toContain('workspace:');
  });

  it('names a missing dependency in validation errors', () => {
    const missingSdk = {
      ...dependencyManifests,
      '@codegraph/mcp-server': {
        name: '@codegraph/mcp-server',
        dependencies: {},
      },
    };

    expect(() => createPublishedManifest({
      packageManifest,
      dependencyManifests: missingSdk,
    })).toThrow('@modelcontextprotocol/sdk');
  });
});

describe('source package pack guard', () => {
  it('fails with the canonical repository-root pack command', () => {
    expect(() => rejectSourcePackagePack()).toThrow(
      `Source package packing is disabled. Run "${canonicalPackCommand}" from the repository root.`,
    );
  });
});
