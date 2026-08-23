import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { API_BIND_HOST } from '../env';

const packageDirectory = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const workspaceDirectory = resolve(packageDirectory, '../..');
const temporaryDirectories: string[] = [];

async function reserveUnusedPort(): Promise<number> {
  const reservation = createServer();
  await new Promise<void>((resolvePromise, reject) => {
    reservation.once('error', reject);
    reservation.listen({ port: 0, host: API_BIND_HOST }, resolvePromise);
  });

  const address = reservation.address();
  if (address === null || typeof address === 'string') {
    reservation.close();
    throw new Error('Could not reserve an unused local port');
  }

  await new Promise<void>((resolvePromise, reject) => {
    reservation.close((error) => {
      if (error) reject(error);
      else resolvePromise();
    });
  });
  return address.port;
}

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) =>
      rm(directory, { recursive: true, force: true }),
    ),
  );
});

describe('API server startup', () => {
  it('stays available after an unreachable graph backend rejects the post-listen warmup', async () => {
    const apiPort = await reserveUnusedPort();
    const unreachableGraphPort = await reserveUnusedPort();
    const stateDirectory = await mkdtemp(join(tmpdir(), 'codegraph-api-warmup-'));
    temporaryDirectories.push(stateDirectory);
    const child = spawn(
      process.execPath,
      ['--import', 'tsx', 'packages/api/src/index.ts'],
      {
        cwd: workspaceDirectory,
        env: {
          ...process.env,
          API_PORT: String(apiPort),
          CODEGRAPH_DATA_DIR: stateDirectory,
          CODEGRAPH_DB_PATH: join(stateDirectory, 'db'),
          CODEGRAPH_DRIVER: 'falkordb',
          FALKORDB_URL: `${API_BIND_HOST}:${unreachableGraphPort}`,
        },
        stdio: ['ignore', 'pipe', 'pipe'],
      },
    );

    let stdout = '';
    let stderr = '';
    const listeningLine = `CodeGraph API server running on http://localhost:${apiPort}`;
    const warmupWarning =
      '[codegraph] Graph warmup did not complete; graph requests will retry through storage state.\n';
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');

    try {
      await new Promise<void>((resolvePromise, reject) => {
        const timeout = setTimeout(() => {
          reject(new Error('API server did not emit the graph warmup warning after listening'));
        }, 10_000);
        const inspectOutput = (): void => {
          if (stdout.includes(listeningLine) && stderr.includes(warmupWarning)) {
            clearTimeout(timeout);
            resolvePromise();
          }
        };
        child.stdout.on('data', (chunk: string) => {
          stdout += chunk;
          inspectOutput();
        });
        child.stderr.on('data', (chunk: string) => {
          stderr += chunk;
          inspectOutput();
        });
        child.once('error', (error) => {
          clearTimeout(timeout);
          reject(error);
        });
        child.once('exit', (code, signal) => {
          clearTimeout(timeout);
          reject(new Error(`API server exited during graph warmup: code=${String(code)} signal=${String(signal)}`));
        });
      });

      const healthResponse = await fetch(`http://${API_BIND_HOST}:${apiPort}/health`);
      expect(healthResponse.status).toBe(200);
      expect(child.exitCode).toBeNull();
      expect(child.signalCode).toBeNull();
      expect(stdout).toContain(listeningLine);
      expect(stderr).toBe(warmupWarning);
      expect(stderr).not.toContain('UnhandledPromiseRejection');
    } finally {
      if (child.exitCode === null && child.signalCode === null) child.kill('SIGTERM');
      await new Promise<void>((resolvePromise) => {
        if (child.exitCode !== null || child.signalCode !== null) {
          resolvePromise();
          return;
        }
        child.once('exit', () => resolvePromise());
      });
    }
  }, 15_000);

  it('reports an occupied API bind address without an unhandled stack trace', async () => {
    const blockingServer = createServer();
    await new Promise<void>((resolvePromise, reject) => {
      blockingServer.once('error', reject);
      blockingServer.listen({ port: 0, host: API_BIND_HOST }, resolvePromise);
    });

    const address = blockingServer.address();
    if (address === null || typeof address === 'string') {
      throw new Error('Could not reserve the API bind address');
    }
    expect(address.address).toBe(API_BIND_HOST);
    expect(address.family).toBe('IPv4');

    const stateDirectory = await mkdtemp(join(tmpdir(), 'codegraph-api-startup-'));
    temporaryDirectories.push(stateDirectory);
    const child = spawn(
      process.execPath,
      ['--import', 'tsx', 'packages/api/src/index.ts'],
      {
        cwd: workspaceDirectory,
        env: {
          ...process.env,
          API_PORT: String(address.port),
          CODEGRAPH_DATA_DIR: stateDirectory,
          CODEGRAPH_DB_PATH: join(stateDirectory, 'db'),
        },
        stdio: ['ignore', 'pipe', 'pipe'],
      },
    );

    let stdout = '';
    let stderr = '';
    const expectedError =
      `CodeGraph dashboard could not start on port ${address.port}: the port is already in use. Set API_PORT to another port and try again.\n`;
    let exitAfterErrorTimeout: NodeJS.Timeout | undefined;
    let forcedExitAfterError = false;
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk: string) => {
      stdout += chunk;
    });
    child.stderr.on('data', (chunk: string) => {
      stderr += chunk;
      if (stderr === expectedError && exitAfterErrorTimeout === undefined) {
        exitAfterErrorTimeout = setTimeout(() => {
          forcedExitAfterError = true;
          child.kill('SIGKILL');
        }, 1_000);
      }
    });

    try {
      const exitCode = await new Promise<number | null>((resolvePromise, reject) => {
        const timeout = setTimeout(() => {
          child.kill('SIGKILL');
          reject(new Error('API server did not report the port conflict'));
        }, 15_000);
        child.once('error', (error) => {
          clearTimeout(timeout);
          if (exitAfterErrorTimeout !== undefined) clearTimeout(exitAfterErrorTimeout);
          reject(error);
        });
        child.once('exit', (code) => {
          clearTimeout(timeout);
          if (exitAfterErrorTimeout !== undefined) clearTimeout(exitAfterErrorTimeout);
          resolvePromise(code);
        });
      });

      expect(exitCode).not.toBe(0);
      expect(forcedExitAfterError, 'API server did not exit promptly after the port conflict').toBe(false);
      expect(stdout).toBe('');
      expect(stderr).toBe(expectedError);
    } finally {
      if (child.exitCode === null) child.kill('SIGKILL');
      await new Promise<void>((resolvePromise, reject) => {
        blockingServer.close((error) => {
          if (error) reject(error);
          else resolvePromise();
        });
      });
    }
  }, 20_000);
});
