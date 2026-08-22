import { afterEach, describe, expect, it } from 'vitest';
import { execFileSync, spawn, type ChildProcess } from 'node:child_process';
import { chmod, mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolveEmbeddedBinaryPaths } from '../drivers/falkordblite';

interface WorkerMessage {
  type: 'ready' | 'count' | 'closed' | 'error';
  pid?: number;
  count?: number;
  message?: string;
}

const here = dirname(fileURLToPath(import.meta.url));
const packageRoot = resolve(here, '../..');
const workerPath = join(here, 'fixtures', 'embedded-ownership', 'worker.mts');
const describeIfAvailable = resolveEmbeddedBinaryPaths() ? describe : describe.skip;

function spawnWorker(dataPath: string, createMarker = false): ChildProcess {
  return spawn(process.execPath, ['--import', 'tsx', workerPath], {
    cwd: packageRoot,
    env: {
      ...process.env,
      CODEGRAPH_EMBEDDING_PROVIDER: 'none',
      CODEGRAPH_DB_STARTUP_TIMEOUT_MS: '5000',
      NODE_OPTIONS: '',
      OWNERSHIP_CREATE_MARKER: createMarker ? '1' : '0',
      OWNERSHIP_DATA_PATH: dataPath,
      OWNERSHIP_GRAPH_NAME: 'ownership',
      TSX_TSCONFIG_PATH: join(packageRoot, 'tsconfig.json'),
    },
    stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
  });
}

function serverPidsOf(parentPid: number): number[] {
  const output = execFileSync('ps', ['-eo', 'pid=,ppid=,comm='], { encoding: 'utf8' });
  return output
    .split('\n')
    .map((line) => line.trim().split(/\s+/))
    .filter((parts) => Number(parts[1]) === parentPid && parts.slice(2).join(' ').includes('redis-server'))
    .map((parts) => Number(parts[0]));
}

function waitForMessage(
  child: ChildProcess,
  expectedType: WorkerMessage['type'],
  timeoutMs = 120_000,
): Promise<WorkerMessage> {
  return new Promise((resolvePromise, reject) => {
    let stderr = '';
    child.stderr?.on('data', (chunk: Buffer) => { stderr += chunk.toString(); });
    const timer = setTimeout(() => {
      reject(new Error(`Timed out waiting for ${expectedType}. stderr: ${stderr}`));
    }, timeoutMs);
    const onMessage = (value: unknown): void => {
      const message = value as WorkerMessage;
      if (message.type === 'error') {
        clearTimeout(timer);
        reject(new Error(message.message ?? 'worker failed'));
        return;
      }
      if (message.type === expectedType) {
        clearTimeout(timer);
        child.off('message', onMessage);
        resolvePromise(message);
      }
    };
    child.on('message', onMessage);
    child.once('exit', (code, signal) => {
      clearTimeout(timer);
      reject(new Error(`Worker exited before ${expectedType}: code=${code} signal=${signal}. stderr: ${stderr}`));
    });
  });
}

async function closeWorker(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) return;
  const closed = waitForMessage(child, 'closed', 30_000);
  child.send({ type: 'close' });
  await closed;
}

async function markerCount(child: ChildProcess): Promise<number> {
  const response = waitForMessage(child, 'count');
  child.send({ type: 'count' });
  return (await response).count ?? 0;
}

describeIfAvailable('FalkorDBLite data-path ownership', () => {
  const children: ChildProcess[] = [];
  const dataPaths: string[] = [];

  afterEach(async () => {
    for (const child of children.splice(0)) {
      if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
    }
    for (const dataPath of dataPaths.splice(0)) {
      await rm(dataPath, { recursive: true, force: true });
    }
  });

  async function freshDataPath(prefix: string): Promise<string> {
    const path = await mkdtemp(join(tmpdir(), prefix));
    dataPaths.push(path);
    return path;
  }

  it('attaches a second process to the owner and exposes the same graph', async () => {
    const dataPath = await freshDataPath('cg-owner-probe-ab-');
    const owner = spawnWorker(dataPath, true);
    children.push(owner);
    await waitForMessage(owner, 'ready');

    const attached = spawnWorker(dataPath);
    children.push(attached);
    await waitForMessage(attached, 'ready');

    expect(await markerCount(attached)).toBe(1);
    await closeWorker(attached);
    expect(await markerCount(owner)).toBe(1);
    const sockets = (await readdir(dataPath)).filter((name) => name.endsWith('.sock'));
    expect(sockets).toHaveLength(1);
  }, 180_000);

  it('preserves owner data when the attached process closes after the owner', async () => {
    const dataPath = await freshDataPath('cg-owner-probe-c-');
    const owner = spawnWorker(dataPath, true);
    children.push(owner);
    await waitForMessage(owner, 'ready');
    const attached = spawnWorker(dataPath);
    children.push(attached);
    await waitForMessage(attached, 'ready');

    await closeWorker(owner);
    await expect(markerCount(attached)).rejects.toThrow('Embedded database owner disconnected');
    if (attached.exitCode === null && attached.signalCode === null) {
      await new Promise<void>((resolvePromise) => attached.once('exit', () => resolvePromise()));
    }

    const reopened = spawnWorker(dataPath);
    children.push(reopened);
    await waitForMessage(reopened, 'ready');
    expect(await markerCount(reopened)).toBe(1);
  }, 180_000);

  it('reclaims a stale owner lock whose PID is dead', async () => {
    const dataPath = await freshDataPath('cg-owner-stale-');
    const lockPath = join(dataPath, '.codegraph-embedded-owner.lock');
    await mkdir(lockPath, { mode: 0o700 });
    await writeFile(join(lockPath, 'claim-999999999-dead-process.lock'), '', { mode: 0o600 });

    const owner = spawnWorker(dataPath, true);
    children.push(owner);
    const ready = await waitForMessage(owner, 'ready');
    expect(await markerCount(owner)).toBe(1);
    const claimFiles = await readdir(lockPath);
    expect(claimFiles).toHaveLength(1);
    expect(claimFiles[0]).toMatch(new RegExp(`^claim-${ready.pid}-`));
    await expect(
      readFile(join(dataPath, '.codegraph-embedded-owner.json'), 'utf8'),
    ).resolves.toContain('"graphProtocolVersion":"1"');
  }, 180_000);

  it('resolves simultaneous starts to one server owner', async () => {
    const dataPath = await freshDataPath('cg-owner-race-');
    const first = spawnWorker(dataPath);
    const second = spawnWorker(dataPath);
    children.push(first, second);

    await Promise.all([waitForMessage(first, 'ready'), waitForMessage(second, 'ready')]);
    const sockets = (await readdir(dataPath)).filter((name) => name.endsWith('.sock'));
    expect(sockets).toHaveLength(1);

    const lease = JSON.parse(
      await readFile(join(dataPath, '.codegraph-embedded-owner.json'), 'utf8'),
    ) as Record<string, unknown>;
    expect(lease).toMatchObject({
      version: 1,
      dataPath,
      graphProtocolVersion: '1',
    });
    expect(typeof lease['ownerPid']).toBe('number');
    expect(typeof lease['ownerStartToken']).toBe('string');
    expect(typeof lease['socketPath']).toBe('string');
    const claimDirectory = join(dataPath, '.codegraph-embedded-owner.lock');
    expect((await stat(claimDirectory)).mode & 0o777).toBe(0o700);
    const claimFiles = await readdir(claimDirectory);
    expect(claimFiles).toHaveLength(1);
    expect((await stat(join(claimDirectory, claimFiles[0]!))).mode & 0o777).toBe(0o600);
    expect((await stat(join(dataPath, '.codegraph-embedded-owner.json'))).mode & 0o777).toBe(0o600);
    expect((await stat(lease['socketPath'] as string)).mode & 0o777).toBe(0o700);
  }, 180_000);

  it('fails clearly when a live owner has an incompatible protocol lease', async () => {
    const dataPath = await freshDataPath('cg-owner-incompatible-');
    const owner = spawnWorker(dataPath);
    children.push(owner);
    const ready = await waitForMessage(owner, 'ready');
    const leasePath = join(dataPath, '.codegraph-embedded-owner.json');
    const lease = JSON.parse(await readFile(leasePath, 'utf8')) as Record<string, unknown>;
    lease['graphProtocolVersion'] = 'incompatible';
    await writeFile(leasePath, JSON.stringify(lease), { mode: 0o600 });
    await chmod(leasePath, 0o600);

    const attached = spawnWorker(dataPath);
    children.push(attached);
    await expect(waitForMessage(attached, 'ready')).rejects.toThrow(
      new RegExp(`owned by PID ${ready.pid}.*protocol version is incompatible.*Stop the other CodeGraph process`),
    );
  }, 180_000);

  it('saves and reclaims an orphaned server after its owner is killed', async () => {
    const dataPath = await freshDataPath('cg-owner-hard-kill-');
    const owner = spawnWorker(dataPath, true);
    children.push(owner);
    await waitForMessage(owner, 'ready');
    const orphanPids = serverPidsOf(owner.pid!);
    expect(orphanPids).toHaveLength(1);
    await rm(join(dataPath, '.codegraph-embedded-owner.json'));

    owner.kill('SIGKILL');
    await new Promise<void>((resolvePromise) => owner.once('exit', () => resolvePromise()));

    const recovered = spawnWorker(dataPath);
    children.push(recovered);
    await waitForMessage(recovered, 'ready');
    expect(await markerCount(recovered)).toBe(1);
    expect(orphanPids.every((pid) => {
      try {
        process.kill(pid, 0);
        return false;
      } catch {
        return true;
      }
    })).toBe(true);
  }, 180_000);
});
