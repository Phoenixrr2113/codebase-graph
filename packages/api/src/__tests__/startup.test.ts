import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';

const packageDirectory = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const workspaceDirectory = resolve(packageDirectory, '../..');
const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) =>
      rm(directory, { recursive: true, force: true }),
    ),
  );
});

describe('API server startup', () => {
  it('reports an occupied IPv6 wildcard port without an unhandled stack trace', async () => {
    const blockingServer = createServer();
    await new Promise<void>((resolvePromise, reject) => {
      blockingServer.once('error', reject);
      blockingServer.listen({ port: 0, host: '::' }, resolvePromise);
    });

    const address = blockingServer.address();
    if (address === null || typeof address === 'string') {
      throw new Error('Could not reserve an IPv6 wildcard port');
    }

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
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk: string) => {
      stdout += chunk;
    });
    child.stderr.on('data', (chunk: string) => {
      stderr += chunk;
    });

    try {
      const exitCode = await new Promise<number | null>((resolvePromise, reject) => {
        const timeout = setTimeout(() => {
          child.kill('SIGKILL');
          reject(new Error('API server did not exit after the port conflict'));
        }, 5_000);
        child.once('error', (error) => {
          clearTimeout(timeout);
          reject(error);
        });
        child.once('exit', (code) => {
          clearTimeout(timeout);
          resolvePromise(code);
        });
      });

      expect(exitCode).not.toBe(0);
      expect(stdout).toBe('');
      expect(stderr).toBe(
        `CodeGraph dashboard could not start on port ${address.port}: the port is already in use. Set API_PORT to another port and try again.\n`,
      );
    } finally {
      if (child.exitCode === null) child.kill('SIGKILL');
      await new Promise<void>((resolvePromise, reject) => {
        blockingServer.close((error) => {
          if (error) reject(error);
          else resolvePromise();
        });
      });
    }
  }, 10_000);
});
