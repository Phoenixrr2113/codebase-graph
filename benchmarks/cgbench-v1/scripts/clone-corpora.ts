import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ManifestSchema, type Manifest } from '../src/types.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');

export function parseManifest(): Manifest {
  const raw = readFileSync(join(ROOT, 'corpora/code/manifest.json'), 'utf-8');
  return ManifestSchema.parse(JSON.parse(raw));
}

export function isShaCheckedOut(dir: string, sha: string): boolean {
  if (!existsSync(join(dir, '.git'))) return false;
  try {
    const head = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: dir, stdio: 'pipe' })
      .toString()
      .trim();
    return head === sha;
  } catch {
    return false;
  }
}

function cloneAndCheckout(
  url: string,
  sha: string,
  dest: string,
): void {
  if (!existsSync(dest)) {
    execFileSync('git', ['clone', '--quiet', url, dest], { stdio: 'inherit' });
  }
  try {
    execFileSync('git', ['fetch', '--quiet', 'origin', sha], { cwd: dest, stdio: 'pipe' });
  } catch (err) {
    throw new Error(
      `Failed to fetch ${sha} from ${url}. ` +
      `Check network, that the SHA exists, and that the server allows fetching by SHA. ` +
      `Original error: ${(err as Error).message}`,
    );
  }
  // Pinning to a SHA puts the corpus in detached-HEAD state — that's expected.
  execFileSync('git', ['checkout', '--quiet', sha], { cwd: dest, stdio: 'inherit' });
}

async function main(): Promise<void> {
  const manifest = parseManifest();
  for (const c of manifest.corpora) {
    const dest = join(ROOT, 'corpora/code', c.name);
    if (isShaCheckedOut(dest, c.commitSha)) {
      console.log(`[skip] ${c.name} already at ${c.commitSha.slice(0, 8)}`);
      continue;
    }
    console.log(`[clone] ${c.name} -> ${c.commitSha.slice(0, 8)}`);
    cloneAndCheckout(c.url, c.commitSha, dest);
  }
  console.log(`[done] ${manifest.corpora.length} corpora ready`);
}

if (process.argv[1]?.endsWith('clone-corpora.ts')) {
  main().catch((err: unknown) => {
    console.error(err);
    process.exit(1);
  });
}
