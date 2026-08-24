import { afterEach, describe, expect, it } from 'vitest';
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const packageDirectory = dirname(dirname(fileURLToPath(import.meta.url)));
const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe('codegraph-mcp CLI', () => {
  it('reads --version from the adjacent package manifest', () => {
    const fixtureDirectory = mkdtempSync(join(tmpdir(), 'codegraph-cli-'));
    temporaryDirectories.push(fixtureDirectory);
    mkdirSync(join(fixtureDirectory, 'bin'));
    copyFileSync(
      join(packageDirectory, 'bin', 'codegraph-mcp.mjs'),
      join(fixtureDirectory, 'bin', 'codegraph-mcp.mjs'),
    );
    writeFileSync(
      join(fixtureDirectory, 'package.json'),
      JSON.stringify({ name: '@codegraph/mcp', version: '9.8.7', type: 'module' }),
    );

    const result = spawnSync(
      process.execPath,
      [join(fixtureDirectory, 'bin', 'codegraph-mcp.mjs'), '--version'],
      { encoding: 'utf8' },
    );

    expect(result.status).toBe(0);
    expect(result.stdout).toBe('9.8.7\n');
    expect(result.stderr).toBe('');
  });

  it('loads the adjacent server entry module', () => {
    const fixtureDirectory = mkdtempSync(join(tmpdir(), 'codegraph-cli-'));
    temporaryDirectories.push(fixtureDirectory);
    mkdirSync(join(fixtureDirectory, 'bin'));
    mkdirSync(join(fixtureDirectory, 'server'));
    copyFileSync(
      join(packageDirectory, 'bin', 'codegraph-mcp.mjs'),
      join(fixtureDirectory, 'bin', 'codegraph-mcp.mjs'),
    );
    writeFileSync(
      join(fixtureDirectory, 'package.json'),
      JSON.stringify({ name: '@codegraph/mcp', version: '9.8.7', type: 'module' }),
    );
    writeFileSync(
      join(fixtureDirectory, 'server', 'index.mjs'),
      "process.stderr.write('fixture server loaded\\n');\n",
    );

    const result = spawnSync(
      process.execPath,
      [join(fixtureDirectory, 'bin', 'codegraph-mcp.mjs')],
      { encoding: 'utf8' },
    );

    expect(result.status).toBe(0);
    expect(result.stdout).toBe('');
    expect(result.stderr).toBe('fixture server loaded\n');
  });
});
