#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import { access, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * @typedef {{
 *   run(command: string, args: string[], options: import('node:child_process').SpawnSyncOptionsWithStringEncoding): import('node:child_process').SpawnSyncReturns<string>
 * }} CommandRunner
 */

const requiredTools = ['search', 'knowledge', 'codebase', 'query'];
const releaseDirectory = dirname(fileURLToPath(import.meta.url));
const rootDirectory = resolve(releaseDirectory, '../..');

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

function parseHandshake(stdout) {
  let parsed;
  try {
    parsed = JSON.parse(stdout);
  } catch {
    throw new Error('MCP handshake emitted non-JSON data on stdout');
  }
  if (typeof parsed !== 'object' || parsed === null || !Array.isArray(parsed.tools)) {
    throw new Error('MCP handshake result must contain a tools array');
  }
  if (!parsed.tools.every((toolName) => typeof toolName === 'string')) {
    throw new Error('MCP handshake returned an invalid tool name');
  }
  if (typeof parsed.databaseVerified !== 'boolean') {
    throw new Error('MCP handshake result must report database verification');
  }
  for (const toolName of requiredTools) {
    if (!parsed.tools.includes(toolName)) {
      throw new Error(`MCP handshake did not expose required tool: ${toolName}`);
    }
  }
  return {
    tools: parsed.tools,
    databaseVerified: parsed.databaseVerified,
  };
}

const handshakeSource = `
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const binPath = process.argv[2];
const environment = Object.fromEntries(
  Object.entries(process.env).filter((entry) => typeof entry[1] === 'string'),
);
environment.CODEGRAPH_EMBEDDING_PROVIDER = 'none';
environment.CODEGRAPH_LOG_STDERR = 'true';

const transport = new StdioClientTransport({
  command: process.execPath,
  args: [binPath],
  env: environment,
  stderr: 'pipe',
});
const client = new Client(
  { name: 'codegraph-package-smoke', version: '1.0.0' },
  { capabilities: {} },
);
let serverStderr = '';
transport.stderr?.on('data', (chunk) => {
  serverStderr = (serverStderr + chunk.toString()).slice(-4000);
});

try {
  await client.connect(transport);
  const result = await client.listTools();
  const supportsEmbeddedDatabase =
    (process.platform === 'darwin' && process.arch === 'arm64') ||
    (process.platform === 'linux' && process.arch === 'x64');
  let databaseVerified = false;
  if (supportsEmbeddedDatabase) {
    const storeResult = await client.callTool({
      name: 'knowledge',
      arguments: {
        action: 'store',
        text: 'codegraph package smoke',
        type: 'Verification',
      },
    });
    const storeText = storeResult.content.find((item) => item.type === 'text')?.text;
    if (storeResult.isError || typeof storeText !== 'string') {
      throw new Error('Database-backed knowledge store call failed');
    }
    const stored = JSON.parse(storeText);
    if (typeof stored !== 'object' || stored === null || stored.stored !== true) {
      throw new Error('Database-backed knowledge store returned an error');
    }
    const queryResult = await client.callTool({
      name: 'query',
      arguments: {
        cypher: 'MATCH (n:Entity {text: $text}) RETURN count(n) AS count',
        params: { text: 'codegraph package smoke' },
      },
    });
    const queryText = queryResult.content.find((item) => item.type === 'text')?.text;
    if (queryResult.isError || typeof queryText !== 'string') {
      throw new Error('Database-backed verification query failed');
    }
    const verification = JSON.parse(queryText);
    if (
      typeof verification !== 'object'
      || verification === null
      || verification.success !== true
      || !Array.isArray(verification.data)
      || verification.data[0]?.count !== 1
    ) {
      throw new Error(
        'Database-backed verification query returned an error: ' + JSON.stringify(verification),
      );
    }
    databaseVerified = true;
  }
  await client.close();
  process.stdout.write(JSON.stringify({
    tools: result.tools.map((tool) => tool.name),
    databaseVerified,
  }) + '\\n');
} catch (error) {
  await client.close().catch(() => {});
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(message + (serverStderr ? '\\n' + serverStderr : '') + '\\n');
  process.exitCode = 1;
}
`;

export async function smokePackage({ tarballPath, expectedVersion, runner = defaultRunner }) {
  const absoluteTarball = resolve(tarballPath);
  try {
    await access(absoluteTarball);
  } catch {
    throw new Error(`Package tarball does not exist: ${absoluteTarball}`);
  }
  if (typeof expectedVersion !== 'string' || expectedVersion.length === 0) {
    throw new TypeError('expectedVersion must be a non-empty string');
  }

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

    const binPath = join(
      consumerDirectory,
      'node_modules',
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

    const handshakePath = join(consumerDirectory, 'mcp-handshake.mjs');
    await writeFile(handshakePath, handshakeSource);
    const smokeEnvironment = {
      ...process.env,
      CODEGRAPH_DATA_DIR: join(consumerDirectory, 'data'),
      CODEGRAPH_DB_PATH: join(consumerDirectory, 'db'),
    };
    const handshakeResult = runner.run(
      process.execPath,
      [handshakePath, binPath],
      {
        cwd: consumerDirectory,
        encoding: 'utf8',
        env: smokeEnvironment,
        timeout: 60_000,
      },
    );
    if (handshakeResult.status !== 0) {
      throw commandFailure('MCP handshake', handshakeResult);
    }
    const handshake = parseHandshake(handshakeResult.stdout);
    return { version: installedVersion, ...handshake };
  } finally {
    await rm(consumerDirectory, { recursive: true, force: true });
  }
}

export function resolveSmokeInput(argumentsList, defaultResultPath) {
  if (argumentsList.length === 0) {
    return { kind: 'result', resultPath: resolve(defaultResultPath) };
  }
  if (argumentsList.length === 1 && !argumentsList[0].startsWith('--')) {
    return { kind: 'result', resultPath: resolve(argumentsList[0]) };
  }
  const values = new Map();
  for (let index = 0; index < argumentsList.length; index += 2) {
    const flag = argumentsList[index];
    const value = argumentsList[index + 1];
    if (!['--tarball', '--version'].includes(flag) || !value) {
      throw new Error('Usage: smoke-package.mjs [result.json] or --tarball <path> --version <semver>');
    }
    values.set(flag, value);
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
  const result = await smokePackage(resolveValidatedPackageInput(packageResult, input.resultPath));
  process.stdout.write(`${JSON.stringify(result)}\n`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  runCli().catch((error) => {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`${message}\n`);
    process.exitCode = 1;
  });
}
