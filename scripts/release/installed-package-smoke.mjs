#!/usr/bin/env node

import { spawn } from 'node:child_process';
import { readdir, writeFile } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const expectedGuidance =
  'Embedded FalkorDBLite is unavailable on this platform. Set CODEGRAPH_DRIVER=falkordb and FALKORDB_URL, or configure FALKORDB_HOST and FALKORDB_PORT.';
const expectedTools = ['analyze', 'codebase', 'knowledge', 'query', 'search'];
const mode = process.argv[2] ?? 'basic';
const packageDirectory = process.argv[3];
const fixtureDirectory = process.argv[4];
const dataDirectory = process.argv[5];
const databaseDirectory = process.argv[6];
const mcpBin = join(packageDirectory, 'bin', 'codegraph-mcp.mjs');
const dashboardBin = join(packageDirectory, 'bin', 'codegraph-dashboard.mjs');

function pass(label) {
  process.stdout.write(`PASS ${label}\n`);
}

function requireCondition(condition, message) {
  if (!condition) throw new Error(message);
}

function parseToolJson(result, label) {
  requireCondition(result.isError !== true, `${label} returned an MCP error`);
  const text = result.content.find((item) => item.type === 'text')?.text;
  requireCondition(typeof text === 'string', `${label} did not return text content`);
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`${label} returned invalid JSON`);
  }
}

async function freePort() {
  const { createServer } = await import('node:net');
  return await new Promise((resolvePort, rejectPort) => {
    const server = createServer();
    server.once('error', rejectPort);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      const port = typeof address === 'object' && address !== null ? address.port : 0;
      server.close(() => port > 0 ? resolvePort(port) : rejectPort(new Error('no free port')));
    });
  });
}

async function waitForExit(child, timeoutMs = 30_000) {
  if (child.exitCode !== null) return;
  await Promise.race([
    new Promise((resolveExit) => child.once('exit', resolveExit)),
    new Promise((_, rejectExit) => setTimeout(
      () => rejectExit(new Error(`process ${child.pid ?? '<unknown>'} did not exit`)),
      timeoutMs,
    )),
  ]);
}

async function stopChild(child) {
  if (child.exitCode === null) child.kill('SIGTERM');
  try {
    await waitForExit(child);
  } catch (error) {
    if (child.exitCode === null) child.kill('SIGKILL');
    await waitForExit(child, 5_000).catch(() => {});
    throw error;
  }
}

async function requestJson(baseUrl, path, options = {}) {
  const response = await fetch(`${baseUrl}${path}`, options);
  const text = await response.text();
  let body;
  try {
    body = JSON.parse(text);
  } catch {
    throw new Error(`${path} returned non-JSON HTTP ${response.status}: ${text.slice(0, 200)}`);
  }
  requireCondition(response.status === 200, `${path} expected HTTP 200, received ${response.status}: ${text.slice(0, 300)}`);
  return body;
}

async function startDashboard(environment) {
  const port = await freePort();
  const child = spawn(process.execPath, [dashboardBin], {
    cwd: fixtureDirectory,
    env: { ...environment, API_PORT: String(port) },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let output = '';
  child.stdout.on('data', (chunk) => { output = (output + String(chunk)).slice(-100_000); });
  child.stderr.on('data', (chunk) => { output = (output + String(chunk)).slice(-100_000); });
  const baseUrl = `http://127.0.0.1:${port}`;
  const deadline = Date.now() + 90_000;
  for (;;) {
    if (child.exitCode !== null) {
      throw new Error(`dashboard exited with code ${child.exitCode}: ${output.slice(-2_000)}`);
    }
    try {
      const response = await fetch(`${baseUrl}/health`);
      if (response.status === 200) break;
    } catch {
      // Continue until the bounded readiness deadline.
    }
    if (Date.now() >= deadline) {
      await stopChild(child).catch(() => {});
      throw new Error(`dashboard readiness timed out: ${output.slice(-2_000)}`);
    }
    await new Promise((resolveWait) => setTimeout(resolveWait, 250));
  }
  return { child, baseUrl, output: () => output };
}

async function startMcp(environment) {
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [mcpBin],
    env: environment,
    stderr: 'pipe',
  });
  let stderr = '';
  transport.stderr?.on('data', (chunk) => { stderr = (stderr + String(chunk)).slice(-100_000); });
  const client = new Client(
    { name: 'codegraph-installed-package-smoke', version: '1.0.0' },
    { capabilities: {} },
  );
  try {
    await client.connect(transport);
    return { client, transport, stderr: () => stderr };
  } catch (error) {
    await transport.close().catch(() => {});
    throw new Error(`MCP initialize failed: ${error instanceof Error ? error.message : String(error)}\n${stderr}`);
  }
}

async function closeMcp(session) {
  await session.client.close();
}

async function mcpCall(session, name, args) {
  return parseToolJson(await session.client.callTool({ name, arguments: args }), `${name} tool`);
}

async function graphNodeCount(baseUrl) {
  const graph = await requestJson(baseUrl, '/api/graph/full?limit=100');
  requireCondition(Array.isArray(graph.nodes), 'graph response must contain nodes');
  return graph.nodes.length;
}

async function socketCount(directory) {
  let entries;
  try {
    entries = await readdir(directory, { withFileTypes: true });
  } catch {
    return 0;
  }
  let count = 0;
  for (const entry of entries) {
    if (entry.isDirectory()) count += await socketCount(join(directory, entry.name));
    if (entry.isSocket() || entry.name.endsWith('.sock')) count += 1;
  }
  return count;
}

async function assertMcpQuery(session) {
  const query = await mcpCall(session, 'query', {
    cypher: 'MATCH (n) RETURN count(n) AS count',
  });
  requireCondition(query.success === true, 'MCP query did not report success');
  requireCondition(Array.isArray(query.data) && query.data[0]?.count > 0, 'MCP query returned no indexed nodes');
}

async function runUnsupported(environment) {
  const dashboard = await startDashboard(environment);
  try {
    const setup = await requestJson(dashboard.baseUrl, '/api/setup/status');
    requireCondition(setup.storage?.embeddedSupported === false, 'unsupported platform reported embedded storage support');
    requireCondition(setup.storage?.externalGuidance === expectedGuidance, 'external FalkorDB guidance did not match the frozen contract');
    pass('unsupported platform returns external FalkorDB guidance without crashing');
  } finally {
    await stopChild(dashboard.child);
  }
}

async function runBasic(environment) {
  let dashboard = await startDashboard(environment);
  try {
    const health = await requestJson(dashboard.baseUrl, '/health');
    requireCondition(health.status === 'ok', 'health response did not report ok');
    pass('dashboard health returns 200');

    const rootResponse = await fetch(`${dashboard.baseUrl}/`);
    const rootHtml = await rootResponse.text();
    requireCondition(rootResponse.status === 200 && rootHtml.includes('id="root"'), 'dashboard root asset document was unavailable');
    const assetPath = rootHtml.match(/\/assets\/[A-Za-z0-9._-]+\.js/)?.[0];
    requireCondition(typeof assetPath === 'string', 'dashboard root referenced no built JavaScript asset');
    const assetResponse = await fetch(`${dashboard.baseUrl}${assetPath}`);
    requireCondition(assetResponse.status === 200, `dashboard asset returned HTTP ${assetResponse.status}`);
    pass('dashboard root and built JavaScript asset return 200');

    const projects = await requestJson(dashboard.baseUrl, '/api/projects');
    requireCondition(Array.isArray(projects.projects) && projects.projects.length === 0, 'new database projects were not empty');
    pass('dashboard empty projects returns 200 with an empty list');

    const embeddings = await requestJson(dashboard.baseUrl, '/api/embeddings/status');
    requireCondition(Array.isArray(embeddings.labels) && embeddings.labels.length === 0, 'new database embedding coverage was not zero');
    pass('dashboard empty embedding status returns 200 with zero coverage');

    const setup = await requestJson(dashboard.baseUrl, '/api/setup/status');
    requireCondition(setup.projects?.configured === false && setup.projects?.count === 0, 'new database setup status was configured');
    pass('dashboard setup status returns 200 and reports not configured');

    const roots = await requestJson(dashboard.baseUrl, '/api/fs/directories');
    requireCondition(
      Array.isArray(roots.entries) && roots.entries.some((entry) => entry.name === basename(fixtureDirectory)),
      'Browse roots omitted the fixture',
    );
    pass('dashboard Browse roots lists the fixture directory');
  } finally {
    await stopChild(dashboard.child);
  }

  let mcp = await startMcp(environment);
  try {
    const serverVersion = mcp.client.getServerVersion();
    requireCondition(serverVersion?.name === 'codegraph-mcp-server', 'MCP initialize returned the wrong server identity');
    pass('MCP initialize succeeds over installed binary stdio');

    const tools = (await mcp.client.listTools()).tools.map((tool) => tool.name).sort();
    requireCondition(JSON.stringify(tools) === JSON.stringify(expectedTools), `MCP tools/list returned ${JSON.stringify(tools)}`);
    pass('MCP tools/list exposes all five tools');

    const status = await mcpCall(mcp, 'codebase', { action: 'status' });
    requireCondition(status.configured === false && status.setupRequired === true && status.error === undefined, 'MCP empty status was not setup-safe');
    pass('MCP codebase status reports not configured without error');

    const configured = await mcpCall(mcp, 'codebase', {
      action: 'configure',
      projectAction: 'set',
      projects: [fixtureDirectory],
    });
    requireCondition(Array.isArray(configured.activeProjects) && configured.activeProjects.includes(fixtureDirectory), 'MCP configure did not activate the fixture');
    pass('MCP configures the fixture project');

    const indexed = await mcpCall(mcp, 'codebase', {
      action: 'reindex',
      mode: 'full',
      scope: fixtureDirectory,
    });
    requireCondition(indexed.success === true && indexed.filesProcessed >= 1 && indexed.symbolsUpdated >= 1, 'MCP reindex did not index the fixture');
    pass('MCP indexes the fixture project');

    await assertMcpQuery(mcp);
    pass('MCP query reads an indexed node');
  } finally {
    await closeMcp(mcp);
  }

  mcp = await startMcp(environment);
  try {
    await assertMcpQuery(mcp);
    pass('MCP restart preserves indexed data');
  } finally {
    await closeMcp(mcp);
  }

  await writeFile(
    join(fixtureDirectory, 'dashboard-api.ts'),
    "export const dashboardApiMarker = 'indexed-through-dashboard-api';\n",
  );
  dashboard = await startDashboard(environment);
  try {
    const indexed = await requestJson(dashboard.baseUrl, '/api/parse/project', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ path: fixtureDirectory }),
    });
    requireCondition(indexed.parsed === true && indexed.stats?.files >= 1, 'dashboard API did not index the fixture');
    pass('dashboard API indexes the fixture project');
    requireCondition(await graphNodeCount(dashboard.baseUrl) > 0, 'dashboard graph contained no indexed nodes');
    pass('dashboard API returns an indexed node');
  } finally {
    await stopChild(dashboard.child);
  }

  dashboard = await startDashboard(environment);
  try {
    requireCondition(await graphNodeCount(dashboard.baseUrl) > 0, 'dashboard restart lost indexed nodes');
    pass('dashboard restart preserves indexed data');

    mcp = await startMcp(environment);
    try {
      await assertMcpQuery(mcp);
      requireCondition(await graphNodeCount(dashboard.baseUrl) > 0, 'dashboard could not read data while MCP was attached');
      pass('dashboard and MCP concurrently read the same indexed data');
      requireCondition(await socketCount(databaseDirectory) === 1, 'concurrent binaries did not share exactly one embedded server socket');
      pass('concurrent binaries use exactly one embedded server');
    } finally {
      await closeMcp(mcp);
    }
    requireCondition(await graphNodeCount(dashboard.baseUrl) > 0, 'stopping MCP first disrupted dashboard data');
    pass('stopping MCP first leaves dashboard data readable');
  } finally {
    await stopChild(dashboard.child);
  }

  dashboard = await startDashboard(environment);
  mcp = await startMcp(environment);
  await assertMcpQuery(mcp);
  requireCondition(await graphNodeCount(dashboard.baseUrl) > 0, 'second concurrent boot could not read data');
  pass('stopping MCP first then dashboard preserves indexed data after both exit');
  await stopChild(dashboard.child);
  await closeMcp(mcp).catch(() => {});
  dashboard = await startDashboard(environment);
  try {
    requireCondition(await graphNodeCount(dashboard.baseUrl) > 0, 'stopping dashboard first lost persisted data');
    pass('stopping dashboard first preserves indexed data after both processes exit');
  } finally {
    await stopChild(dashboard.child);
  }
}

async function runLocal(environment) {
  const localEnvironment = {
    ...environment,
    CODEGRAPH_EMBEDDING_PROVIDER: 'local',
  };
  const dashboard = await startDashboard(localEnvironment);
  try {
    const indexed = await requestJson(dashboard.baseUrl, '/api/parse/project', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ path: fixtureDirectory }),
    });
    requireCondition(
      indexed.parsed === true && indexed.stats?.embedded > 0,
      `local provider did not create embeddings: ${JSON.stringify(indexed)}\n${dashboard.output().slice(-4_000)}`,
    );
    requireCondition(/Local embedding model load progress\./.test(dashboard.output()), 'cold local-provider output contained no download progress');
    pass('cold local provider prints download progress');

    const vectorProbe = await requestJson(dashboard.baseUrl, '/api/query/cypher', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        query: "CALL db.idx.vector.queryNodes('Function', 'embedding', 1, vecf32($vector)) YIELD node RETURN node LIMIT 0",
        params: { vector: Array.from({ length: 768 }, () => 0) },
      }),
    });
    requireCondition(Array.isArray(vectorProbe.results), '768-dimension vector index probe failed');
    pass('local provider creates a usable 768-dimension vector index');
  } finally {
    await stopChild(dashboard.child);
  }
}

async function main() {
  requireCondition(packageDirectory && fixtureDirectory && dataDirectory && databaseDirectory, 'installed smoke arguments are incomplete');
  await writeFile(join(fixtureDirectory, 'fixture.ts'), [
    'export function greet(name: string): string {',
    '  return `hello ${name}`;',
    '}',
    '',
    "export const greeting = greet('release-smoke');",
    '',
  ].join('\n'));
  await writeFile(join(fixtureDirectory, 'package.json'), '{"name":"codegraph-release-smoke","private":true,"type":"module"}\n');

  const environment = {
    ...process.env,
    CODEGRAPH_DATA_DIR: dataDirectory,
    CODEGRAPH_DB_PATH: databaseDirectory,
    CODEGRAPH_DRIVER: 'falkordblite',
    CODEGRAPH_EMBEDDING_PROVIDER: mode === 'local' ? 'local' : 'none',
    CODEGRAPH_BROWSE_ROOTS: fixtureDirectory,
    CODEGRAPH_LOG_STDERR: 'true',
  };

  if (mode === 'unsupported') await runUnsupported(environment);
  else if (mode === 'local') await runLocal(environment);
  else if (mode === 'basic') await runBasic(environment);
  else throw new Error(`unknown installed smoke mode: ${mode}`);
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stdout.write(`FAIL installed package ${mode} smoke: ${message}\n`);
  process.exitCode = 1;
});
