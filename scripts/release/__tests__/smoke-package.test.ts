import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { SpawnSyncReturns } from 'node:child_process';
import {
  resolveNpmInvocation,
  resolveSmokeInput,
  resolveValidatedPackageInput,
  smokePackage,
} from '../smoke-package.mjs';

const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

function processResult(
  status: number,
  stdout = '',
  stderr = '',
): SpawnSyncReturns<string> {
  return {
    pid: 123,
    output: [null, stdout, stderr],
    stdout,
    stderr,
    status,
    signal: null,
    error: undefined,
  };
}

function createTarball(): string {
  const directory = mkdtempSync(join(tmpdir(), 'codegraph-smoke-test-'));
  temporaryDirectories.push(directory);
  const tarballPath = join(directory, 'codegraph-mcp-0.1.0.tgz');
  writeFileSync(tarballPath, 'fixture');
  return tarballPath;
}

function successfulRunner() {
  return {
    run: vi.fn()
      .mockReturnValueOnce(processResult(0))
      .mockReturnValueOnce(processResult(0, '0.1.0\n'))
      .mockReturnValueOnce(processResult(0, JSON.stringify({
        tools: ['search', 'knowledge', 'codebase', 'query'],
        databaseVerified: true,
      }))),
  };
}

describe('smokePackage', () => {
  it('launches npm through cmd.exe on Windows', () => {
    expect(resolveNpmInvocation('win32', 'C:\\Windows\\System32\\cmd.exe')).toEqual({
      command: 'C:\\Windows\\System32\\cmd.exe',
      args: ['/d', '/s', '/c', 'npm.cmd'],
    });
    expect(resolveNpmInvocation('linux')).toEqual({ command: 'npm', args: [] });
    expect(resolveNpmInvocation('darwin')).toEqual({ command: 'npm', args: [] });
  });

  it('rejects a missing tarball before running commands', async () => {
    const runner = successfulRunner();

    await expect(smokePackage({
      verifyDashboard: async () => ({ port: 0, asset: '/assets/index-test.js' }),
      tarballPath: '/tmp/codegraph-missing-package.tgz',
      expectedVersion: '0.1.0',
      runner,
    })).rejects.toThrow('does not exist');
    expect(runner.run).not.toHaveBeenCalled();
  });

  it('rejects a failed npm install', async () => {
    const runner = { run: vi.fn().mockReturnValue(processResult(1, '', 'install failed')) };

    await expect(smokePackage({
      verifyDashboard: async () => ({ port: 0, asset: '/assets/index-test.js' }),
      tarballPath: createTarball(),
      expectedVersion: '0.1.0',
      runner,
    })).rejects.toThrow('install failed');
  });

  it('reports a spawn error when stderr is unavailable', async () => {
    const runner = {
      run: vi.fn().mockReturnValue({
        pid: 0,
        output: null,
        stdout: undefined,
        stderr: undefined,
        status: null,
        signal: null,
        error: new Error('spawn EINVAL'),
      }),
    };

    await expect(smokePackage({
      verifyDashboard: async () => ({ port: 0, asset: '/assets/index-test.js' }),
      tarballPath: createTarball(),
      expectedVersion: '0.1.0',
      runner,
    })).rejects.toThrow('spawn EINVAL');
  });

  it('rejects a CLI version mismatch', async () => {
    const runner = {
      run: vi.fn()
        .mockReturnValueOnce(processResult(0))
        .mockReturnValueOnce(processResult(0, '9.9.9\n')),
    };

    await expect(smokePackage({
      verifyDashboard: async () => ({ port: 0, asset: '/assets/index-test.js' }),
      tarballPath: createTarball(),
      expectedVersion: '0.1.0',
      runner,
    })).rejects.toThrow(/9\.9\.9[\s\S]*0\.1\.0/);
  });

  it('rejects non-JSON handshake output', async () => {
    const runner = successfulRunner();
    runner.run.mockReset()
      .mockReturnValueOnce(processResult(0))
      .mockReturnValueOnce(processResult(0, '0.1.0\n'))
      .mockReturnValueOnce(processResult(0, 'server log on stdout'));

    await expect(smokePackage({
      verifyDashboard: async () => ({ port: 0, asset: '/assets/index-test.js' }),
      tarballPath: createTarball(),
      expectedVersion: '0.1.0',
      runner,
    })).rejects.toThrow('non-JSON');
  });

  it('requires all four public MCP tools', async () => {
    const runner = successfulRunner();
    runner.run.mockReset()
      .mockReturnValueOnce(processResult(0))
      .mockReturnValueOnce(processResult(0, '0.1.0\n'))
      .mockReturnValueOnce(processResult(0, JSON.stringify({
        tools: ['search'],
        databaseVerified: true,
      })));

    await expect(smokePackage({
      verifyDashboard: async () => ({ port: 0, asset: '/assets/index-test.js' }),
      tarballPath: createTarball(),
      expectedVersion: '0.1.0',
      runner,
    })).rejects.toThrow('knowledge');
  });

  it('returns the installed version and tool names after a valid smoke run', async () => {
    await expect(smokePackage({
      verifyDashboard: async () => ({ port: 0, asset: '/assets/index-test.js' }),
      tarballPath: createTarball(),
      expectedVersion: '0.1.0',
      runner: successfulRunner(),
    })).resolves.toMatchObject({
      version: '0.1.0',
      tools: ['search', 'knowledge', 'codebase', 'query'],
      databaseVerified: true,
    });
  });

  it('bounds every external command', async () => {
    const runner = successfulRunner();

    await smokePackage({
      verifyDashboard: async () => ({ port: 0, asset: '/assets/index-test.js' }),
      tarballPath: createTarball(),
      expectedVersion: '0.1.0',
      runner,
    });

    expect(runner.run.mock.calls.map((call) => call[2].timeout)).toEqual([
      300_000,
      30_000,
      60_000,
    ]);
  });

  it('isolates package state and uses a short embedded database path', async () => {
    const runner = successfulRunner();

    await smokePackage({
      verifyDashboard: async () => ({ port: 0, asset: '/assets/index-test.js' }),
      tarballPath: createTarball(),
      expectedVersion: '0.1.0',
      runner,
    });

    const handshakeOptions = runner.run.mock.calls[2][2];
    expect(handshakeOptions.env).toEqual(expect.objectContaining({
      CODEGRAPH_DATA_DIR: expect.stringMatching(/\/data$/),
      CODEGRAPH_DB_PATH: expect.stringMatching(/\/db$/),
    }));
    expect(String(handshakeOptions.env?.CODEGRAPH_DB_PATH).length).toBeLessThan(90);
  });
});

describe('resolveSmokeInput', () => {
  it('uses a validation result when no CLI arguments are provided', () => {
    expect(resolveSmokeInput([], '/repo/tmp/release/package-result.json')).toEqual({
      kind: 'result',
      resultPath: '/repo/tmp/release/package-result.json',
    });
  });

  it('accepts an exact tarball and version for downloaded CI artifacts', () => {
    expect(resolveSmokeInput([
      '--tarball',
      '/repo/tmp/release/codegraph-mcp-0.1.0.tgz',
      '--version',
      '0.1.0',
    ], '/repo/tmp/release/package-result.json')).toEqual({
      kind: 'tarball',
      tarballPath: '/repo/tmp/release/codegraph-mcp-0.1.0.tgz',
      expectedVersion: '0.1.0',
    });
  });

  it('rejects incomplete direct tarball input', () => {
    expect(() => resolveSmokeInput([
      '--tarball',
      '/repo/tmp/release/codegraph-mcp-0.1.0.tgz',
    ], '/repo/tmp/release/package-result.json')).toThrow('--version');
  });
});

describe('resolveValidatedPackageInput', () => {
  it('relocates a downloaded artifact beside its validation result', () => {
    expect(resolveValidatedPackageInput({
      tarballPath: '/home/runner/work/repo/tmp/release/codegraph-mcp-0.1.0.tgz',
      filename: 'codegraph-mcp-0.1.0.tgz',
      version: '0.1.0',
    }, '/different-runner/tmp/release/package-result.json')).toEqual({
      tarballPath: '/different-runner/tmp/release/codegraph-mcp-0.1.0.tgz',
      expectedVersion: '0.1.0',
    });
  });

  it('rejects an unsafe artifact filename', () => {
    expect(() => resolveValidatedPackageInput({
      filename: '../codegraph-mcp.tgz',
      version: '0.1.0',
    }, '/repo/tmp/release/package-result.json')).toThrow('filename');
  });
});
