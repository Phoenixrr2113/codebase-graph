#!/usr/bin/env node

/**
 * Audits the dependency tree an npm consumer actually installs.
 *
 * `pnpm audit --prod` audits this monorepo, where root `pnpm.overrides` can pin
 * a transitive dependency to a patched version. Those overrides are a property
 * of this workspace and do NOT travel to anyone who runs `npm i codegraph-mcp`.
 * Auditing only the workspace therefore reports "clean" while consumers install
 * something else. This script closes that gap by resolving the published
 * manifest's dependencies the way npm would for an end user.
 *
 * Advisories with no upstream fix are acknowledged explicitly below rather than
 * being hidden by an override, and a stale acknowledgement fails the run so the
 * list cannot rot.
 */

import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const releaseDirectory = dirname(fileURLToPath(import.meta.url));
const rootDirectory = resolve(releaseDirectory, '../..');
const defaultManifestPath = join(rootDirectory, 'packages/npm-package/dist/package.json');

export const severityRank = { info: 0, low: 1, moderate: 2, high: 3, critical: 4 };
export const defaultThreshold = 'high';

/**
 * Advisories we have reviewed, cannot fix from here, and accept for now.
 * Every entry must record why it is unfixable and when it was last reviewed.
 */
export const acknowledgedAdvisories = [
  {
    advisory: 'GHSA-f88m-g3jw-g9cj',
    package: 'sharp',
    reviewedOn: '2026-08-19',
    reason:
      'libvips CVEs affecting sharp <0.35.0, reachable only through @huggingface/transformers. ' +
      'Every published transformers release from 3.8.1 through 4.2.0 declares sharp ^0.34.x, so no ' +
      'upstream version resolves to a patched sharp. CodeGraph never invokes the transformers image ' +
      'path, so the vulnerable code is installed but not exercised. Revisit when transformers widens ' +
      'its sharp range.',
  },
];

/** Extract the GHSA identifier from an advisory URL. */
export function advisoryIdFromUrl(url) {
  if (typeof url !== 'string') return undefined;
  const match = url.match(/(GHSA-[0-9a-z-]+)/i);
  return match ? match[1] : undefined;
}

/**
 * Flatten an `npm audit --json` report into one record per distinct advisory.
 * Only object entries in `via` name a real advisory; string entries just point
 * at the upstream package that carries it.
 */
export function extractAdvisories(report) {
  const vulnerabilities =
    report !== null && typeof report === 'object' ? (report.vulnerabilities ?? {}) : {};
  const byId = new Map();
  for (const entry of Object.values(vulnerabilities)) {
    if (entry === null || typeof entry !== 'object' || !Array.isArray(entry.via)) continue;
    for (const via of entry.via) {
      if (via === null || typeof via !== 'object') continue;
      const advisory = advisoryIdFromUrl(via.url) ?? `source-${String(via.source ?? 'unknown')}`;
      if (byId.has(advisory)) continue;
      byId.set(advisory, {
        advisory,
        package: typeof via.name === 'string' ? via.name : 'unknown',
        severity: typeof via.severity === 'string' ? via.severity : 'unknown',
        title: typeof via.title === 'string' ? via.title : '',
        url: typeof via.url === 'string' ? via.url : '',
        range: typeof via.range === 'string' ? via.range : '',
        fixAvailable: entry.fixAvailable !== false,
      });
    }
  }
  return [...byId.values()].sort((a, b) => a.advisory.localeCompare(b.advisory));
}

/**
 * Split advisories into blocking and acknowledged, and surface acknowledgements
 * that no longer match anything so the allowlist stays truthful.
 */
export function partitionAdvisories(advisories, acknowledged, threshold = defaultThreshold) {
  const minimum = severityRank[threshold] ?? severityRank[defaultThreshold];
  const matched = new Set();
  const blocking = [];

  for (const advisory of advisories) {
    const rank = severityRank[advisory.severity] ?? severityRank.critical;
    const allowance = acknowledged.find(
      (item) => item.advisory === advisory.advisory && item.package === advisory.package,
    );
    if (allowance !== undefined) {
      matched.add(allowance.advisory);
      continue;
    }
    if (rank >= minimum) blocking.push(advisory);
  }

  const stale = acknowledged.filter((item) => !matched.has(item.advisory));
  return { blocking, stale };
}

/** Resolve the consumer dependency tree in a temp project and audit it. */
export function auditConsumerTree(dependencies, npmCommand = 'npm') {
  const workDir = mkdtempSync(join(tmpdir(), 'codegraph-consumer-audit-'));
  try {
    writeFileSync(
      join(workDir, 'package.json'),
      `${JSON.stringify({ name: 'codegraph-consumer-audit', version: '0.0.0', private: true, dependencies }, null, 2)}\n`,
    );
    const install = spawnSync(
      npmCommand,
      ['install', '--package-lock-only', '--ignore-scripts', '--legacy-peer-deps', '--no-audit', '--no-fund'],
      { cwd: workDir, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 },
    );
    if (install.status !== 0) {
      throw new Error(
        `npm install failed while resolving the consumer tree: ${String(install.stderr ?? '').trim() || `exit ${install.status}`}`,
      );
    }
    const audit = spawnSync(npmCommand, ['audit', '--omit=dev', '--json'], {
      cwd: workDir,
      encoding: 'utf8',
      maxBuffer: 32 * 1024 * 1024,
    });
    // npm audit exits non-zero when it finds anything, so parse regardless.
    const stdout = String(audit.stdout ?? '').trim();
    if (stdout.length === 0) {
      throw new Error(`npm audit produced no output: ${String(audit.stderr ?? '').trim()}`);
    }
    return JSON.parse(stdout);
  } finally {
    rmSync(workDir, { recursive: true, force: true });
  }
}

async function runCli() {
  const manifestPath = process.argv[2] ?? defaultManifestPath;
  let manifest;
  try {
    manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
  } catch (error) {
    throw new Error(
      `Unable to read the published manifest at ${manifestPath}. Run "pnpm build:npm" first. ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }

  const dependencies = manifest.dependencies ?? {};
  const names = Object.keys(dependencies);
  if (names.length === 0) {
    process.stdout.write('Published package declares no runtime dependencies; nothing to audit.\n');
    return;
  }

  process.stdout.write(
    `Auditing the consumer tree for ${manifest.name}@${manifest.version} (${names.length} runtime dependencies).\n`,
  );

  const report = auditConsumerTree(dependencies);
  const advisories = extractAdvisories(report);
  const { blocking, stale } = partitionAdvisories(advisories, acknowledgedAdvisories);

  for (const item of advisories) {
    const state = blocking.includes(item) ? 'BLOCKING' : 'acknowledged';
    process.stdout.write(`  [${state}] ${item.severity} ${item.package} ${item.advisory} ${item.url}\n`);
  }

  const problems = [];
  if (blocking.length > 0) {
    problems.push(
      `${blocking.length} unacknowledged advisory/advisories at or above "${defaultThreshold}" in the consumer tree.`,
    );
  }
  if (stale.length > 0) {
    problems.push(
      `Stale acknowledgement(s) that no longer match any advisory: ${stale
        .map((item) => `${item.package} ${item.advisory}`)
        .join(', ')}. Remove them from acknowledgedAdvisories.`,
    );
  }

  if (problems.length > 0) {
    throw new Error(problems.join('\n'));
  }

  process.stdout.write(
    `Consumer tree audit passed: ${advisories.length} advisory/advisories, all acknowledged.\n`,
  );
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  runCli().catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
