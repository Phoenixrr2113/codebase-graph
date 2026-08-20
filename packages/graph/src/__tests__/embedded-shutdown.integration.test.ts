/**
 * The embedded server must not outlive the process that spawned it.
 *
 * This is the case that leaked in practice. connect() removes the wrapper's
 * SIGINT/SIGTERM handlers so they cannot stop Redis before our client has
 * disconnected, and a process killed by a signal never runs its 'exit'
 * handlers. Without a replacement handler the spawned redis-server was
 * reparented to init and kept running against the same data directory as every
 * later run, so their snapshots competed with each other.
 */

import { describe, it, expect, afterEach } from 'vitest';
import { spawn, execFileSync } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';
import { resolveEmbeddedBinaryPaths } from '../drivers/falkordblite';

const here = dirname(fileURLToPath(import.meta.url));
const packageRoot = resolve(here, '../..');
const graphEntry = join(packageRoot, 'src', 'index.ts');
const describeIfAvailable = resolveEmbeddedBinaryPaths() ? describe : describe.skip;

/**
 * Embedded servers spawned by a given process.
 *
 * Matching on the data directory is not an option: the server's command line
 * carries an absolute path that `ps` truncates well before the interesting part.
 * The parent PID is short, exact, and available while the parent is alive.
 */
function serverPidsOf(parentPid: number): number[] {
  const out = execFileSync('ps', ['-eo', 'pid=,ppid=,comm='], { encoding: 'utf8' });
  return out
    .split('\n')
    .map((line) => line.trim().split(/\s+/))
    .filter(
      (parts) =>
        parts.length >= 3 &&
        Number(parts[1]) === parentPid &&
        parts.slice(2).join(' ').includes('redis-server'),
    )
    .map((parts) => Number(parts[0]));
}

function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function waitFor(predicate: () => boolean, budgetMs: number): Promise<boolean> {
  const deadline = Date.now() + budgetMs;
  while (Date.now() < deadline) {
    if (predicate()) return true;
    await new Promise((r) => setTimeout(r, 100));
  }
  return predicate();
}

describeIfAvailable('embedded server shutdown', () => {
  const cleanup: Array<() => Promise<void>> = [];

  afterEach(async () => {
    for (const task of cleanup.splice(0)) await task();
  });

  it('stops the embedded server when the owning process is terminated', async () => {
    const dataDir = await mkdtemp(join(tmpdir(), 'cg-shutdown-'));
    const script = join(dataDir, 'holder.mts');

    // Loaded from source through tsx: the compiled dist emits extensionless
    // relative imports, which plain Node ESM cannot resolve.
    await writeFile(
      script,
      `import { createClient } from ${JSON.stringify(graphEntry)};
       const client = await createClient({ driver: 'falkordblite', databasePath: ${JSON.stringify(dataDir)}, graphName: 'shutdown' });
       await client.query('CREATE (:Marker {v: 1})');
       process.stdout.write('READY\\n');
       setInterval(() => {}, 1000);
      `,
    );

    const child = spawn(process.execPath, ['--import', 'tsx', script], {
      cwd: packageRoot,
      env: {
        ...process.env,
        // tsx reads its tsconfig from cwd, and only the package config enables
        // the decorators this code compiles with. Name the file outright, and
        // drop the runner's own loader options so they cannot conflict.
        TSX_TSCONFIG_PATH: join(packageRoot, 'tsconfig.json'),
        NODE_OPTIONS: '',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let serverPids: number[] = [];
    cleanup.push(async () => {
      if (!child.killed) child.kill('SIGKILL');
      for (const pid of serverPids) {
        try { process.kill(pid, 'SIGKILL'); } catch { /* already gone */ }
      }
      await rm(dataDir, { recursive: true, force: true });
    });

    let childErr = '';
    child.stderr.on('data', (buf: Buffer) => { childErr += buf.toString(); });
    const ready = await new Promise<boolean>((resolvePromise) => {
      const timer = setTimeout(() => resolvePromise(false), 120_000);
      child.stdout.on('data', (buf: Buffer) => {
        if (buf.toString().includes('READY')) { clearTimeout(timer); resolvePromise(true); }
      });
      child.on('exit', () => { clearTimeout(timer); resolvePromise(false); });
    });
    expect(ready, `child never signalled ready: ${childErr}`).toBe(true);

    serverPids = serverPidsOf(child.pid!);
    expect(serverPids.length, 'no embedded server was spawned to begin with').toBeGreaterThan(0);

    child.kill('SIGTERM');
    await new Promise<void>((r) => child.on('exit', () => r()));

    const reaped = await waitFor(() => serverPids.every((pid) => !isAlive(pid)), 30_000);
    expect(reaped, `embedded server ${serverPids.join(', ')} outlived its process`).toBe(true);
  }, 180_000);
});
