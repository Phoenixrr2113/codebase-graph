#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * @typedef {{
 *   run(command: string, args: string[], options: import('node:child_process').SpawnSyncOptionsWithStringEncoding): import('node:child_process').SpawnSyncReturns<string>
 * }} CommandRunner
 */

const requiredTools = ['analyze', 'codebase', 'knowledge', 'query', 'search'];
const releaseDirectory = dirname(fileURLToPath(import.meta.url));
const rootDirectory = resolve(releaseDirectory, '../..');
const installedSmokePath = resolve(releaseDirectory, 'installed-package-smoke.mjs');
const unsupportedStorageContractPath = resolve(releaseDirectory, 'unsupported-storage-contract.mjs');

const defaultRunner = {
  run(command, args, options) {
    return spawnSync(command, args, options);
  },
};

function commandFailure(label, result) {
  const stderr = typeof result.stderr === 'string' ? result.stderr.trim() : '';
  const detail = stderr || result.error?.message || `exit status ${result.status}`;
  return new Error(`${label} failed: ${detail}`);
}

export function createPassReporter(writeLine = (line) => process.stdout.write(`${line}\n`)) {
  return {
    pass(label) {
      writeLine(`PASS ${label}`);
    },
    fail(label, error) {
      const message = error instanceof Error ? error.message : String(error);
      writeLine(`FAIL ${label}: ${message}`);
    },
  };
}

export function assertRequiredTools(tools) {
  for (const toolName of requiredTools) {
    if (!tools.includes(toolName)) {
      throw new Error(`MCP handshake did not expose required tool: ${toolName}`);
    }
  }
  return [...tools].sort();
}

export function parseToolJson(result, label) {
  if (result?.isError === true) {
    throw new Error(`${label} returned an MCP error`);
  }
  const text = result?.content?.find((item) => item?.type === 'text')?.text;
  if (typeof text !== 'string') {
    throw new Error(`${label} did not return text content`);
  }
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`${label} returned invalid JSON`);
  }
}

export function resolveInstalledSmokeMode({
  requestedMode,
  platform = process.platform,
  architecture = process.arch,
  environment = process.env,
  fileExists = existsSync,
}) {
  if (requestedMode !== 'basic') return requestedMode;
  if (environment.FALKORDB_URL || environment.FALKORDB_HOST) return 'basic';
  if (platform === 'linux' && architecture === 'x64') return 'basic';
  if (platform !== 'darwin' || architecture !== 'arm64') return 'unsupported';

  const embeddedLibrariesPresent = [
    '/opt/homebrew/opt/libomp/lib/libomp.dylib',
    '/opt/homebrew/opt/openssl@3/lib/libssl.3.dylib',
    '/opt/homebrew/opt/openssl@3/lib/libcrypto.3.dylib',
  ].every(fileExists);
  return embeddedLibrariesPresent ? 'basic' : 'unsupported';
}

export async function assertHttpJson({ fetcher = fetch, url, label, assertBody }) {
  const response = await fetcher(url);
  if (response.status !== 200) {
    throw new Error(`${label} expected HTTP 200, received ${response.status}`);
  }
  const body = await response.json();
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    throw new Error(`${label} returned a non-object JSON body`);
  }
  assertBody(body);
  return body;
}

export function resolveNpmInvocation(
  platform = process.platform,
  windowsCommand = process.env.ComSpec || 'cmd.exe',
) {
  if (platform === 'win32') {
    return {
      command: windowsCommand,
      args: ['/d', '/s', '/c', 'npm.cmd'],
    };
  }
  return { command: 'npm', args: [] };
}

export async function smokePackage({
  tarballPath,
  expectedVersion,
  mode = 'basic',
  runner = defaultRunner,
  reporter = createPassReporter(),
}) {
  const absoluteTarball = resolve(tarballPath);
  try {
    await access(absoluteTarball);
  } catch {
    throw new Error(`Package tarball does not exist: ${absoluteTarball}`);
  }
  if (typeof expectedVersion !== 'string' || expectedVersion.length === 0) {
    throw new TypeError('expectedVersion must be a non-empty string');
  }
  if (!['basic', 'unsupported', 'local'].includes(mode)) {
    throw new TypeError(`Unsupported smoke mode: ${mode}`);
  }
  const installedMode = resolveInstalledSmokeMode({ requestedMode: mode });

  const sha256 = createHash('sha256').update(await readFile(absoluteTarball)).digest('hex');

  const consumerDirectory = await mkdtemp(join(tmpdir(), 'cg-'));
  try {
    await writeFile(
      join(consumerDirectory, 'package.json'),
      '{"name":"codegraph-package-smoke","version":"1.0.0","private":true,"type":"module"}\n',
    );
    const npmInvocation = resolveNpmInvocation();
    const installResult = runner.run(
      npmInvocation.command,
      [...npmInvocation.args, 'install', absoluteTarball, '--ignore-scripts', '--no-audit', '--no-fund'],
      { cwd: consumerDirectory, encoding: 'utf8', timeout: 300_000 },
    );
    if (installResult.status !== 0) {
      throw commandFailure('npm install', installResult);
    }
    reporter.pass('installed exact canonical tarball into a clean consumer');

    const binPath = join(
      consumerDirectory,
      'node_modules',
      '@agntk',
      'codegraph-mcp',
      'bin',
      'codegraph-mcp.mjs',
    );
    const versionResult = runner.run(
      process.execPath,
      [binPath, '--version'],
      { cwd: consumerDirectory, encoding: 'utf8', timeout: 30_000 },
    );
    if (versionResult.status !== 0) {
      throw commandFailure('codegraph-mcp --version', versionResult);
    }
    const installedVersion = versionResult.stdout.trim();
    if (installedVersion !== expectedVersion) {
      throw new Error(
        `Installed CLI version ${installedVersion || '<empty>'} does not match expected ${expectedVersion}`,
      );
    }
    reporter.pass(`installed codegraph-mcp reports version ${expectedVersion}`);

    const installedSmoke = join(consumerDirectory, 'installed-package-smoke.mjs');
    await Promise.all([
      writeFile(installedSmoke, await readFile(installedSmokePath)),
      writeFile(
        join(consumerDirectory, 'unsupported-storage-contract.mjs'),
        await readFile(unsupportedStorageContractPath),
      ),
    ]);
    const fixtureDirectory = join(consumerDirectory, 'fixture');
    const dataDirectory = join(consumerDirectory, 'data');
    const databaseDirectory = join(consumerDirectory, 'db');
    await Promise.all([
      mkdir(fixtureDirectory),
      mkdir(dataDirectory),
      mkdir(databaseDirectory),
    ]);
    const smokeEnvironment = {
      ...process.env,
      CODEGRAPH_DATA_DIR: dataDirectory,
      CODEGRAPH_DB_PATH: databaseDirectory,
    };
    const packageDirectory = join(consumerDirectory, 'node_modules', '@agntk', 'codegraph-mcp');
    const runtimeResult = runner.run(
      process.execPath,
      [
        installedSmoke,
        installedMode,
        packageDirectory,
        fixtureDirectory,
        dataDirectory,
        databaseDirectory,
      ],
      {
        cwd: consumerDirectory,
        encoding: 'utf8',
        env: smokeEnvironment,
        timeout: installedMode === 'local' ? 900_000 : 300_000,
      },
    );
    if (typeof runtimeResult.stdout === 'string' && runtimeResult.stdout.length > 0) {
      process.stdout.write(runtimeResult.stdout);
    }
    if (runtimeResult.status !== 0) {
      throw commandFailure(`installed package ${installedMode} smoke`, runtimeResult);
    }
    reporter.pass(`tarball SHA-256 ${sha256}`);

    return { version: installedVersion, mode: installedMode, sha256 };
  } finally {
    await rm(consumerDirectory, { recursive: true, force: true });
  }
}

export function resolveSmokeInput(argumentsList, defaultResultPath) {
  if (argumentsList.length === 0) {
    return { kind: 'result', resultPath: resolve(defaultResultPath), mode: 'basic' };
  }
  if (argumentsList.length === 1 && !argumentsList[0].startsWith('--')) {
    return { kind: 'result', resultPath: resolve(argumentsList[0]), mode: 'basic' };
  }
  const values = new Map();
  for (let index = 0; index < argumentsList.length; index += 2) {
    const flag = argumentsList[index];
    const value = argumentsList[index + 1];
    if (!['--tarball', '--version', '--result', '--mode'].includes(flag) || !value) {
      throw new Error('Usage: smoke-package.mjs [result.json] [--mode basic|unsupported|local] or --tarball <path> --version <semver> [--mode basic|unsupported|local]');
    }
    values.set(flag, value);
  }
  const mode = values.get('--mode') ?? 'basic';
  if (!['basic', 'unsupported', 'local'].includes(mode)) {
    throw new Error(`Invalid smoke mode: ${mode}`);
  }
  const resultPath = values.get('--result');
  if (resultPath) {
    if (values.has('--tarball') || values.has('--version')) {
      throw new Error('--result cannot be combined with --tarball or --version');
    }
    return { kind: 'result', resultPath: resolve(resultPath), mode };
  }
  const tarballPath = values.get('--tarball');
  const expectedVersion = values.get('--version');
  if (!tarballPath || !expectedVersion) {
    throw new Error('Direct smoke input requires both --tarball and --version');
  }
  return {
    kind: 'tarball',
    tarballPath: resolve(tarballPath),
    expectedVersion,
    mode,
  };
}

export function resolveValidatedPackageInput(packageResult, resultPath) {
  if (
    typeof packageResult !== 'object' ||
    packageResult === null ||
    typeof packageResult.filename !== 'string' ||
    basename(packageResult.filename) !== packageResult.filename ||
    !packageResult.filename.endsWith('.tgz')
  ) {
    throw new Error('Package validation result has an invalid artifact filename');
  }
  if (typeof packageResult.version !== 'string' || packageResult.version.length === 0) {
    throw new Error('Package validation result is missing a version');
  }
  return {
    tarballPath: resolve(dirname(resultPath), packageResult.filename),
    expectedVersion: packageResult.version,
  };
}

async function runCli() {
  const input = resolveSmokeInput(
    process.argv.slice(2),
    join(rootDirectory, 'tmp/release/package-result.json'),
  );
  if (input.kind === 'tarball') {
    const result = await smokePackage(input);
    process.stdout.write(`${JSON.stringify(result)}\n`);
    return;
  }
  let packageResult;
  try {
    packageResult = JSON.parse(await readFile(input.resultPath, 'utf8'));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Unable to read package validation result: ${message}`);
  }
  const result = await smokePackage({
    ...resolveValidatedPackageInput(packageResult, input.resultPath),
    mode: input.mode,
  });
  process.stdout.write(`${JSON.stringify(result)}\n`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  runCli().catch((error) => {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`FAIL release package smoke: ${message}\n`);
    process.exitCode = 1;
  });
}
