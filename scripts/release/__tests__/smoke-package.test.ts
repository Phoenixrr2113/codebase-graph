import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { SpawnSyncReturns } from 'node:child_process';
import {
  assertHttpJson,
  assertRequiredTools,
  createPassReporter,
  parseToolJson,
  resolveInstalledSmokeMode,
  resolveNpmInvocation,
  resolveSmokeInput,
  resolveValidatedPackageInput,
  smokePackage,
} from '../smoke-package.mjs';
import { assertUnsupportedMcpStatus } from '../unsupported-storage-contract.mjs';

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
  const tarballPath = join(directory, 'agntk-codegraph-mcp-0.1.0.tgz');
  writeFileSync(tarballPath, 'fixture');
  return tarballPath;
}

function successfulRunner() {
  return {
    run: vi.fn()
      .mockReturnValueOnce(processResult(0))
      .mockReturnValueOnce(processResult(0, '0.1.0\n'))
      .mockReturnValueOnce(processResult(0, 'PASS installed runtime acceptance\n')),
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

  it('rejects a failed installed runtime smoke', async () => {
    const runner = successfulRunner();
    runner.run.mockReset()
      .mockReturnValueOnce(processResult(0))
      .mockReturnValueOnce(processResult(0, '0.1.0\n'))
      .mockReturnValueOnce(processResult(1, 'FAIL dashboard health: HTTP 500\n', 'runtime failed'));

    await expect(smokePackage({
      verifyDashboard: async () => ({ port: 0, asset: '/assets/index-test.js' }),
      tarballPath: createTarball(),
      expectedVersion: '0.1.0',
      runner,
    })).rejects.toThrow('runtime failed');
  });

  it('returns the installed version and tool names after a valid smoke run', async () => {
    await expect(smokePackage({
      verifyDashboard: async () => ({ port: 0, asset: '/assets/index-test.js' }),
      tarballPath: createTarball(),
      expectedVersion: '0.1.0',
      runner: successfulRunner(),
    })).resolves.toMatchObject({
      version: '0.1.0',
      mode: 'basic',
      sha256: expect.stringMatching(/^[a-f0-9]{64}$/),
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
      300_000,
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

  it('boots both installed entry points from the scoped package directory', async () => {
    const runner = successfulRunner();

    await smokePackage({
      verifyDashboard: async () => ({ port: 0, asset: '/assets/index-test.js' }),
      tarballPath: createTarball(),
      expectedVersion: '0.1.0',
      runner,
    });

    expect(runner.run.mock.calls[1][1][0]).toMatch(
      /node_modules[\\/]@agntk[\\/]codegraph-mcp[\\/]bin[\\/]codegraph-mcp\.mjs$/,
    );
    expect(runner.run.mock.calls[2][1][2]).toMatch(
      /node_modules[\\/]@agntk[\\/]codegraph-mcp$/,
    );
  });
});

describe('smoke helpers', () => {
  it('requires unsupported MCP status to expose the blocked setup contract', () => {
    const guidance =
      'Embedded FalkorDBLite is unavailable on this platform. Set CODEGRAPH_DRIVER=falkordb and FALKORDB_URL, or configure FALKORDB_HOST and FALKORDB_PORT.';
    const status = {
      configured: false,
      setupRequired: true,
      setup: {
        storage: {
          driver: 'falkordb',
          ownerState: 'blocked',
          embeddedSupported: false,
          externalGuidance: guidance,
        },
      },
    };

    expect(() => assertUnsupportedMcpStatus(status)).not.toThrow();
    expect(() => assertUnsupportedMcpStatus({
      ...status,
      setup: { storage: { ...status.setup.storage, ownerState: 'starting' } },
    })).toThrow('MCP status did not report blocked storage');
  });

  it('selects guidance mode only when embedded storage and external FalkorDB are unavailable', () => {
    expect(resolveInstalledSmokeMode({
      requestedMode: 'basic',
      platform: 'win32',
      architecture: 'x64',
      environment: {},
    })).toBe('unsupported');
    expect(resolveInstalledSmokeMode({
      requestedMode: 'basic',
      platform: 'win32',
      architecture: 'x64',
      environment: { FALKORDB_HOST: 'db.internal' },
    })).toBe('basic');
    expect(resolveInstalledSmokeMode({
      requestedMode: 'basic',
      platform: 'linux',
      architecture: 'x64',
      environment: {},
    })).toBe('basic');
    expect(resolveInstalledSmokeMode({
      requestedMode: 'basic',
      platform: 'darwin',
      architecture: 'arm64',
      environment: {},
      fileExists: () => true,
    })).toBe('basic');
    expect(resolveInstalledSmokeMode({
      requestedMode: 'basic',
      platform: 'darwin',
      architecture: 'arm64',
      environment: {},
      fileExists: () => false,
    })).toBe('unsupported');
  });

  it('requires the complete five-tool public surface', () => {
    expect(() => assertRequiredTools(['search', 'knowledge', 'codebase', 'query'])).toThrow(
      'analyze',
    );
    expect(assertRequiredTools(['analyze', 'query', 'codebase', 'knowledge', 'search'])).toEqual([
      'analyze',
      'codebase',
      'knowledge',
      'query',
      'search',
    ]);
  });

  it('parses successful MCP text content and rejects protocol errors', () => {
    expect(parseToolJson({
      content: [{ type: 'text', text: '{"configured":false}' }],
      isError: false,
    }, 'codebase status')).toEqual({ configured: false });

    expect(() => parseToolJson({
      content: [{ type: 'text', text: '{"error":"boom"}' }],
      isError: true,
    }, 'codebase status')).toThrow('codebase status returned an MCP error');
  });

  it('validates HTTP status and response shape', async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response(
      JSON.stringify({ projects: [] }),
      { status: 200, headers: { 'content-type': 'application/json' } },
    ));

    await expect(assertHttpJson({
      fetcher,
      url: 'http://127.0.0.1:1234/api/projects',
      label: 'projects empty list',
      assertBody: (body) => {
        if (!Array.isArray(body.projects) || body.projects.length !== 0) {
          throw new Error('projects must be empty');
        }
      },
    })).resolves.toEqual({ projects: [] });

    fetcher.mockResolvedValueOnce(new Response('{"error":"nope"}', { status: 500 }));
    await expect(assertHttpJson({
      fetcher,
      url: 'http://127.0.0.1:1234/api/projects',
      label: 'projects empty list',
      assertBody: () => {},
    })).rejects.toThrow('expected HTTP 200, received 500');
  });

  it('prints one plain pass or fail line per step', () => {
    const lines: string[] = [];
    const reporter = createPassReporter((line) => lines.push(line));

    reporter.pass('installed exact tarball');
    reporter.fail('dashboard health', new Error('HTTP 500'));

    expect(lines).toEqual([
      'PASS installed exact tarball',
      'FAIL dashboard health: HTTP 500',
    ]);
  });
});

describe('resolveSmokeInput', () => {
  it('uses a validation result when no CLI arguments are provided', () => {
    expect(resolveSmokeInput([], '/repo/tmp/release/package-result.json')).toEqual({
      kind: 'result',
      resultPath: '/repo/tmp/release/package-result.json',
      mode: 'basic',
    });
  });

  it('accepts an exact tarball and version for downloaded CI artifacts', () => {
    expect(resolveSmokeInput([
      '--tarball',
      '/repo/tmp/release/agntk-codegraph-mcp-0.1.0.tgz',
      '--version',
      '0.1.0',
    ], '/repo/tmp/release/package-result.json')).toEqual({
      kind: 'tarball',
      tarballPath: '/repo/tmp/release/agntk-codegraph-mcp-0.1.0.tgz',
      expectedVersion: '0.1.0',
      mode: 'basic',
    });
  });

  it('accepts an opt-in local-provider mode with a validation result', () => {
    expect(resolveSmokeInput([
      '--result',
      '/repo/tmp/release/package-result.json',
      '--mode',
      'local',
    ], '/unused/result.json')).toEqual({
      kind: 'result',
      resultPath: '/repo/tmp/release/package-result.json',
      mode: 'local',
    });
  });

  it('rejects incomplete direct tarball input', () => {
    expect(() => resolveSmokeInput([
      '--tarball',
      '/repo/tmp/release/agntk-codegraph-mcp-0.1.0.tgz',
    ], '/repo/tmp/release/package-result.json')).toThrow('--version');
  });
});

describe('resolveValidatedPackageInput', () => {
  it('relocates a downloaded artifact beside its validation result', () => {
    expect(resolveValidatedPackageInput({
      tarballPath: '/home/runner/work/repo/tmp/release/agntk-codegraph-mcp-0.1.0.tgz',
      filename: 'agntk-codegraph-mcp-0.1.0.tgz',
      version: '0.1.0',
    }, '/different-runner/tmp/release/package-result.json')).toEqual({
      tarballPath: '/different-runner/tmp/release/agntk-codegraph-mcp-0.1.0.tgz',
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
