import { randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { constants } from 'node:fs';
import {
  access,
  chmod,
  mkdir,
  open,
  readFile,
  readdir,
  rename,
  rm,
  stat,
  unlink,
  writeFile,
} from 'node:fs/promises';
import { createConnection } from 'node:net';
import { basename, dirname, isAbsolute, join, relative, resolve } from 'node:path';

export const EMBEDDED_LEASE_VERSION = 1 as const;
export const EMBEDDED_GRAPH_PROTOCOL_VERSION = '1';

const claimDirectoryName = '.codegraph-embedded-owner.lock';
const leaseFilename = '.codegraph-embedded-owner.json';
export const EMBEDDED_REDIS_PID_FILENAME = '.codegraph-embedded-redis.pid';
const attachPollMs = 50;

interface EmbeddedOwnerClaim {
  version: 1;
  ownerPid: number;
  ownerStartToken: string;
  dataPath: string;
  createdAt: string;
}

export interface EmbeddedOwnerLease extends EmbeddedOwnerClaim {
  socketPath: string;
  graphProtocolVersion: string;
}

export interface EmbeddedOwnerReservation {
  role: 'owner';
  claim: EmbeddedOwnerClaim;
  publish(socketPath: string): Promise<EmbeddedOwnerLease>;
  release(): Promise<void>;
}

interface OwnerWitness {
  close(): void;
}

export interface EmbeddedOwnerAttachment {
  role: 'attached';
  lease: EmbeddedOwnerLease;
}

export type EmbeddedOwnership = EmbeddedOwnerReservation | EmbeddedOwnerAttachment;

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolvePromise) => setTimeout(resolvePromise, milliseconds));
}

function processStartIdentity(pid: number): string | null {
  try {
    const output = execFileSync('ps', ['-o', 'lstart=', '-p', String(pid)], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
    return output.length > 0 ? output : null;
  } catch {
    return null;
  }
}

function createOwnerStartToken(): string {
  const startIdentity = processStartIdentity(process.pid);
  if (!startIdentity) {
    throw new Error(`Cannot determine the start identity for embedded database owner PID ${process.pid}`);
  }
  return Buffer.from(JSON.stringify([startIdentity, randomUUID()]), 'utf8').toString('base64url');
}

function tokenStartIdentity(token: string): string | null {
  try {
    const value: unknown = JSON.parse(Buffer.from(token, 'base64url').toString('utf8'));
    if (!Array.isArray(value) || typeof value[0] !== 'string' || typeof value[1] !== 'string') {
      return null;
    }
    return value[0];
  } catch {
    return null;
  }
}

function isProcessOwnerAlive(claim: EmbeddedOwnerClaim): boolean {
  const expectedStart = tokenStartIdentity(claim.ownerStartToken);
  return expectedStart !== null && processStartIdentity(claim.ownerPid) === expectedStart;
}

function isPidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function isOwnerClaim(value: unknown, dataPath: string): value is EmbeddedOwnerClaim {
  if (!value || typeof value !== 'object') return false;
  const claim = value as Record<string, unknown>;
  return claim['version'] === EMBEDDED_LEASE_VERSION
    && Number.isSafeInteger(claim['ownerPid'])
    && typeof claim['ownerStartToken'] === 'string'
    && claim['dataPath'] === dataPath
    && typeof claim['createdAt'] === 'string';
}

function isOwnerLease(value: unknown, dataPath: string): value is EmbeddedOwnerLease {
  if (!isOwnerClaim(value, dataPath)) return false;
  const lease = value as unknown as Record<string, unknown>;
  return typeof lease['socketPath'] === 'string'
    && typeof lease['graphProtocolVersion'] === 'string';
}

async function readJson(path: string): Promise<unknown> {
  try {
    return JSON.parse(await readFile(path, 'utf8')) as unknown;
  } catch {
    return null;
  }
}

function isSocketPathAllowed(socketPath: string, dataPath: string): boolean {
  if (!isAbsolute(socketPath)) return false;
  const resolvedSocket = resolve(socketPath);
  const resolvedData = resolve(dataPath);
  const insideDataPath = relative(resolvedData, resolvedSocket);
  if (insideDataPath !== '' && !insideDataPath.startsWith('..') && !isAbsolute(insideDataPath)) {
    return true;
  }

  const shortRoot = resolve(dirname(resolvedData), '..');
  const insideShortRoot = relative(shortRoot, resolvedSocket);
  return basename(shortRoot) === 'graphs'
    && insideShortRoot !== ''
    && !insideShortRoot.startsWith('..')
    && !isAbsolute(insideShortRoot);
}

export function isSocketConnectable(socketPath: string, timeoutMs = 500): Promise<boolean> {
  return new Promise((resolvePromise) => {
    const socket = createConnection(socketPath);
    let settled = false;
    const finish = (result: boolean): void => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolvePromise(result);
    };
    socket.setTimeout(timeoutMs);
    socket.once('connect', () => finish(true));
    socket.once('error', () => finish(false));
    socket.once('timeout', () => finish(false));
  });
}

function ownerWitnessName(ownerStartToken: string): string {
  return `codegraph-owner-${ownerStartToken}`;
}

function createOwnerWitness(socketPath: string, ownerStartToken: string): Promise<OwnerWitness> {
  return new Promise((resolvePromise, reject) => {
    const socket = createConnection(socketPath);
    const name = ownerWitnessName(ownerStartToken);
    let settled = false;
    const fail = (error: Error): void => {
      if (settled) return;
      settled = true;
      socket.destroy();
      reject(error);
    };
    socket.setTimeout(3_000);
    socket.once('connect', () => {
      socket.write(`*3\r\n$6\r\nCLIENT\r\n$7\r\nSETNAME\r\n$${Buffer.byteLength(name)}\r\n${name}\r\n`);
    });
    socket.once('data', (data) => {
      if (!data.toString().startsWith('+OK')) {
        fail(new Error('Embedded owner witness registration was rejected'));
        return;
      }
      settled = true;
      socket.setTimeout(0);
      socket.on('error', () => {
        // The witness exists only to tie the lease token to this live owner.
      });
      resolvePromise({ close: () => socket.destroy() });
    });
    socket.once('error', fail);
    socket.once('timeout', () => fail(new Error('Embedded owner witness registration timed out')));
  });
}

function socketHasOwnerWitness(socketPath: string, ownerStartToken: string): Promise<boolean> {
  return new Promise((resolvePromise) => {
    const socket = createConnection(socketPath);
    let response = '';
    let settled = false;
    const finish = (result: boolean): void => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolvePromise(result);
    };
    socket.setTimeout(1_000);
    socket.once('connect', () => {
      socket.write('*2\r\n$6\r\nCLIENT\r\n$4\r\nLIST\r\n');
    });
    socket.on('data', (data) => {
      response += data.toString();
      if (response.includes(`name=${ownerWitnessName(ownerStartToken)}`)) finish(true);
    });
    socket.once('error', () => finish(false));
    socket.once('timeout', () => finish(false));
    socket.once('close', () => finish(
      response.includes(`name=${ownerWitnessName(ownerStartToken)}`),
    ));
  });
}

function claimFilename(pid: number, ownerStartToken: string): string {
  return `claim-${pid}-${ownerStartToken}.lock`;
}

function parseClaimFilename(filename: string, dataPath: string): Omit<EmbeddedOwnerClaim, 'createdAt'> | null {
  const match = /^claim-(\d+)-(.+)\.lock$/.exec(filename);
  if (!match) return null;
  const ownerPid = Number(match[1]);
  const ownerStartToken = match[2];
  if (!Number.isSafeInteger(ownerPid) || !ownerStartToken) return null;
  return {
    version: EMBEDDED_LEASE_VERSION,
    ownerPid,
    ownerStartToken,
    dataPath,
  };
}

async function readClaims(
  claimDirectory: string,
  dataPath: string,
): Promise<Array<{ path: string; claim: EmbeddedOwnerClaim; createdMs: number }>> {
  let filenames: string[];
  try {
    filenames = await readdir(claimDirectory);
  } catch {
    return [];
  }

  const claims: Array<{ path: string; claim: EmbeddedOwnerClaim; createdMs: number }> = [];
  for (const filename of filenames.sort()) {
    const parsed = parseClaimFilename(filename, dataPath);
    if (!parsed) continue;
    const path = join(claimDirectory, filename);
    try {
      const fileStat = await stat(path);
      const createdMs = fileStat.birthtimeMs > 0 ? fileStat.birthtimeMs : fileStat.ctimeMs;
      claims.push({
        path,
        createdMs,
        claim: { ...parsed, createdAt: new Date(createdMs).toISOString() },
      });
    } catch {
      // The claim was released between readdir and stat.
    }
  }
  return claims;
}

async function removeStaleClaims(claimDirectory: string, dataPath: string): Promise<void> {
  const claims = await readClaims(claimDirectory, dataPath);
  await Promise.all(claims
    .filter(({ claim }) => !isProcessOwnerAlive(claim))
    .map(({ path }) => unlink(path).catch(() => undefined)));
}

async function readEmbeddedRedisPid(dataPath: string): Promise<number | null> {
  try {
    const pid = Number.parseInt(await readFile(join(dataPath, EMBEDDED_REDIS_PID_FILENAME), 'utf8'), 10);
    return Number.isSafeInteger(pid) && pid > 0 ? pid : null;
  } catch {
    return null;
  }
}

async function socketPathsIn(dataPath: string): Promise<string[]> {
  const filenames = await readdir(dataPath).catch(() => [] as string[]);
  return filenames
    .filter((filename) => filename.endsWith('.sock'))
    .map((filename) => join(dataPath, filename));
}

async function shutdownAndSave(socketPath: string): Promise<void> {
  await new Promise<void>((resolvePromise) => {
    const socket = createConnection(socketPath);
    const finish = (): void => {
      socket.destroy();
      resolvePromise();
    };
    socket.setTimeout(3_000);
    socket.once('connect', () => {
      socket.write('*2\r\n$8\r\nSHUTDOWN\r\n$4\r\nSAVE\r\n');
    });
    socket.once('error', finish);
    socket.once('timeout', finish);
    socket.once('close', finish);
  });
}

async function stopOrphanedServer(
  dataPath: string,
  leasePath: string,
  startupTimeoutMs: number,
): Promise<void> {
  const value = await readJson(leasePath);
  if (isOwnerLease(value, dataPath) && isProcessOwnerAlive(value)) return;
  if (isOwnerLease(value, dataPath) && !isSocketPathAllowed(value.socketPath, dataPath)) {
    throw ownershipError(value.ownerPid, dataPath, 'its stale lease contains an unsafe socket path');
  }
  const redisPid = await readEmbeddedRedisPid(dataPath);
  if (redisPid === null || !isPidAlive(redisPid)) {
    await unlink(join(dataPath, EMBEDDED_REDIS_PID_FILENAME)).catch(() => undefined);
    return;
  }

  const deadline = Date.now() + startupTimeoutMs;
  let connectableSockets: string[] = [];
  while (Date.now() < deadline) {
    const candidates = new Set(await socketPathsIn(dataPath));
    if (isOwnerLease(value, dataPath)) candidates.add(value.socketPath);
    const checks = await Promise.all(Array.from(candidates, async (socketPath) => ({
      socketPath,
      connectable: await isSocketConnectable(socketPath),
    })));
    connectableSockets = checks.filter(({ connectable }) => connectable).map(({ socketPath }) => socketPath);
    if (connectableSockets.length > 0) break;
    await delay(attachPollMs);
  }

  await Promise.all(connectableSockets.map(shutdownAndSave));
  const shutdownDeadline = Date.now() + 10_000;
  while (Date.now() < shutdownDeadline && isPidAlive(redisPid)) await delay(attachPollMs);
  if (isPidAlive(redisPid)) {
    const ownerPid = isOwnerLease(value, dataPath) ? value.ownerPid : redisPid;
    throw ownershipError(ownerPid, dataPath, 'its orphaned server could not be stopped safely');
  }
  await unlink(join(dataPath, EMBEDDED_REDIS_PID_FILENAME)).catch(() => undefined);
}

function ownershipError(ownerPid: number, dataPath: string, reason: string): Error {
  return new Error(
    `Embedded database path "${dataPath}" is owned by PID ${ownerPid}, but ${reason}. ` +
    'Stop the other CodeGraph process and retry, or configure a different CODEGRAPH_DB_PATH.',
  );
}

async function waitForOwnerLease(
  owner: EmbeddedOwnerClaim,
  leasePath: string,
  dataPath: string,
  timeoutMs: number,
): Promise<EmbeddedOwnerAttachment> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (!isProcessOwnerAlive(owner)) break;
    const value = await readJson(leasePath);
    if (isOwnerLease(value, dataPath)
      && value.ownerPid === owner.ownerPid
      && value.ownerStartToken === owner.ownerStartToken) {
      if (value.graphProtocolVersion !== EMBEDDED_GRAPH_PROTOCOL_VERSION) {
        throw ownershipError(owner.ownerPid, dataPath, 'its protocol version is incompatible');
      }
      if (!isSocketPathAllowed(value.socketPath, dataPath)) {
        throw ownershipError(owner.ownerPid, dataPath, 'its lease contains an unsafe socket path');
      }
      if (await isSocketConnectable(value.socketPath)
        && await socketHasOwnerWitness(value.socketPath, value.ownerStartToken)) {
        return { role: 'attached', lease: value };
      }
    }
    await delay(attachPollMs);
  }
  throw ownershipError(owner.ownerPid, dataPath, 'its embedded server is not ready to accept clients');
}

async function writeJsonAtomically(path: string, value: unknown): Promise<void> {
  const temporaryPath = `${path}.${process.pid}.${randomUUID()}.tmp`;
  await writeFile(temporaryPath, JSON.stringify(value), { mode: 0o600, flag: 'wx' });
  await chmod(temporaryPath, 0o600);
  await rename(temporaryPath, path);
}

export async function acquireEmbeddedOwnership(
  rawDataPath: string,
  startupTimeoutMs: number,
): Promise<EmbeddedOwnership> {
  const dataPath = resolve(rawDataPath);
  const claimDirectory = join(dataPath, claimDirectoryName);
  const leasePath = join(dataPath, leaseFilename);
  await mkdir(dataPath, { recursive: true, mode: 0o700 });
  await mkdir(claimDirectory, { recursive: true, mode: 0o700 });
  await chmod(claimDirectory, 0o700);

  const existing = (await readClaims(claimDirectory, dataPath))
    .sort((left, right) => left.createdMs - right.createdMs || left.path.localeCompare(right.path));
  const liveExisting = existing.find(({ claim }) => isProcessOwnerAlive(claim));
  if (liveExisting) {
    return waitForOwnerLease(liveExisting.claim, leasePath, dataPath, startupTimeoutMs);
  }

  await stopOrphanedServer(dataPath, leasePath, startupTimeoutMs);
  await removeStaleClaims(claimDirectory, dataPath);

  const claim: EmbeddedOwnerClaim = {
    version: EMBEDDED_LEASE_VERSION,
    ownerPid: process.pid,
    ownerStartToken: createOwnerStartToken(),
    dataPath,
    createdAt: new Date().toISOString(),
  };
  const claimPath = join(claimDirectory, claimFilename(claim.ownerPid, claim.ownerStartToken));
  const claimHandle = await open(
    claimPath,
    constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY,
    0o600,
  );
  try {
    await claimHandle.sync();
  } finally {
    await claimHandle.close();
  }

  const contenders = (await readClaims(claimDirectory, dataPath))
    .filter(({ claim: candidate }) => isProcessOwnerAlive(candidate))
    .sort((left, right) => left.createdMs - right.createdMs || left.path.localeCompare(right.path));
  const winner = contenders[0];
  if (!winner) {
    await unlink(claimPath).catch(() => undefined);
    throw new Error(`Failed to acquire embedded database ownership for "${dataPath}"`);
  }
  if (winner.claim.ownerStartToken !== claim.ownerStartToken) {
    await unlink(claimPath).catch(() => undefined);
    return waitForOwnerLease(winner.claim, leasePath, dataPath, startupTimeoutMs);
  }

  let witness: OwnerWitness | null = null;
  return {
    role: 'owner',
    claim,
    async publish(socketPath: string): Promise<EmbeddedOwnerLease> {
      if (!isSocketPathAllowed(socketPath, dataPath)) {
        throw new Error(`Refusing unsafe embedded database socket path "${socketPath}"`);
      }
      await access(socketPath, constants.R_OK | constants.W_OK);
      witness = await createOwnerWitness(socketPath, claim.ownerStartToken);
      const lease: EmbeddedOwnerLease = {
        ...claim,
        socketPath,
        graphProtocolVersion: EMBEDDED_GRAPH_PROTOCOL_VERSION,
      };
      await writeJsonAtomically(leasePath, lease);
      return lease;
    },
    async release(): Promise<void> {
      witness?.close();
      witness = null;
      const currentLease = await readJson(leasePath);
      if (isOwnerLease(currentLease, dataPath)
        && currentLease.ownerStartToken === claim.ownerStartToken) {
        await unlink(leasePath).catch(() => undefined);
      }
      await unlink(claimPath).catch(() => undefined);
      const remaining = await readdir(claimDirectory).catch(() => [] as string[]);
      if (remaining.length === 0) await rm(claimDirectory, { recursive: false }).catch(() => undefined);
    },
  };
}
