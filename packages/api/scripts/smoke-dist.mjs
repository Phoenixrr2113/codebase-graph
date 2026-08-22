import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const packageDirectory = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const workspaceDirectory = resolve(packageDirectory, '../..');

async function reserveFreePort() {
  const server = createServer();
  await new Promise((resolvePromise, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolvePromise);
  });
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Could not reserve a free port');
  await new Promise((resolvePromise, reject) => server.close((error) => {
    if (error) reject(error);
    else resolvePromise();
  }));
  return address.port;
}

async function waitForHealth(port, child, stderr) {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) {
      throw new Error(`API exited with code ${child.exitCode}: ${stderr()}`);
    }
    try {
      const response = await fetch(`http://127.0.0.1:${port}/health`);
      if (response.ok) {
        const body = await response.json();
        if (body.status === 'ok') return;
      }
    } catch {
      await new Promise((resolvePromise) => setTimeout(resolvePromise, 50));
    }
  }
  throw new Error(`Timed out waiting for API health: ${stderr()}`);
}

const stateDirectory = await mkdtemp(resolve(tmpdir(), 'codegraph-api-dist-smoke-'));
const port = await reserveFreePort();
let stderrText = '';
const child = spawn(process.execPath, ['packages/api/dist/index.js'], {
  cwd: workspaceDirectory,
  env: {
    ...process.env,
    API_PORT: String(port),
    CODEGRAPH_DATA_DIR: stateDirectory,
  },
  stdio: ['ignore', 'ignore', 'pipe'],
});
child.stderr.setEncoding('utf8');
child.stderr.on('data', (chunk) => {
  stderrText = `${stderrText}${chunk}`.slice(-8_000);
});

try {
  await waitForHealth(port, child, () => stderrText);
  process.stdout.write(`API dist health smoke passed on free port ${port}.\n`);
} finally {
  if (child.exitCode === null) child.kill('SIGTERM');
  await Promise.race([
    new Promise((resolvePromise) => child.once('exit', resolvePromise)),
    new Promise((resolvePromise) => setTimeout(resolvePromise, 2_000)),
  ]);
  if (child.exitCode === null) child.kill('SIGKILL');
  await rm(stateDirectory, { recursive: true, force: true });
}
