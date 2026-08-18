#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const packageName = 'codegraph-mcp';
const semanticVersionPattern = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-((?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*)(?:\.(?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*))*))?(?:\+([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?$/;
const releaseDirectory = dirname(fileURLToPath(import.meta.url));
const rootDirectory = resolve(releaseDirectory, '../..');

export function verifyReleaseTag(tag, manifestPackageName, packageVersion) {
  if (manifestPackageName !== packageName) {
    throw new Error(`Release manifest name must be ${packageName}, received ${manifestPackageName}`);
  }
  const semanticVersion = packageVersion.match(semanticVersionPattern);
  if (!semanticVersion) {
    throw new Error(`Package version must be a valid semantic version, received ${packageVersion}`);
  }
  if (semanticVersion[4]) {
    throw new Error('Release package version must be stable until prerelease dist-tags are supported');
  }
  const expectedTag = `refs/tags/v${packageVersion}`;
  if (tag !== expectedTag) {
    throw new Error(`Release tag must be ${expectedTag}, received ${tag || '<empty>'}`);
  }
  return { packageName: manifestPackageName, version: packageVersion };
}

export function verifyVersionIsUnpublished(result, name, version) {
  if (result.status === 0) {
    throw new Error(`${name}@${version} already exists on npm`);
  }
  const errorText = `${result.stderr ?? ''}\n${result.stdout ?? ''}`;
  if (result.error) {
    throw new Error(`Unable to query npm: ${result.error.message}`);
  }
  if (!/(?:E404|404 Not Found)/i.test(errorText)) {
    const detail = String(result.stderr ?? '').trim() || `exit status ${result.status}`;
    throw new Error(`Unable to verify npm package availability: ${detail}`);
  }
}

async function runCli() {
  const manifestPath = resolve(rootDirectory, 'packages/npm-package/package.json');
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
  const release = verifyReleaseTag(
    process.env.GITHUB_REF ?? '',
    manifest.name,
    manifest.version,
  );
  const result = spawnSync(
    'npm',
    ['view', `${release.packageName}@${release.version}`, 'version', '--json'],
    { cwd: rootDirectory, encoding: 'utf8' },
  );
  verifyVersionIsUnpublished(result, release.packageName, release.version);
  process.stdout.write(`${release.packageName}@${release.version} is available for publication\n`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  runCli().catch((error) => {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`${message}\n`);
    process.exitCode = 1;
  });
}
