#!/usr/bin/env node

import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const canonicalPackCommand = 'pnpm pack:npm';

export function rejectSourcePackagePack() {
  throw new Error(
    `Source package packing is disabled. Run "${canonicalPackCommand}" from the repository root.`,
  );
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    rejectSourcePackagePack();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`${message}\n`);
    process.exitCode = 1;
  }
}
