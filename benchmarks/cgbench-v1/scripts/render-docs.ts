import { execFileSync } from 'node:child_process';
import { copyFileSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, dirname, extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');

export function hasPandoc(): boolean {
  try {
    execFileSync('pandoc', ['--version'], { stdio: 'pipe' });
    return true;
  } catch {
    return false;
  }
}

export async function renderFact(sourcePath: string, outRoot: string): Promise<void> {
  const id = basename(sourcePath, extname(sourcePath));
  const formats: Array<['md' | 'pdf' | 'docx' | 'html', string]> = [
    ['md', `${id}.md`],
    ['pdf', `${id}.pdf`],
    ['docx', `${id}.docx`],
    ['html', `${id}.html`],
  ];
  for (const [fmt, fname] of formats) {
    const dir = join(outRoot, fmt);
    mkdirSync(dir, { recursive: true });
    const out = join(dir, fname);
    if (fmt === 'md') {
      copyFileSync(sourcePath, out);
    } else {
      execFileSync('pandoc', [sourcePath, '-o', out, '--standalone'], { stdio: 'pipe' });
    }
  }
  // CSV: extract markdown tables to flat rows.
  const csvDir = join(outRoot, 'csv');
  mkdirSync(csvDir, { recursive: true });
  const csv = markdownTablesToCsv(readFileSync(sourcePath, 'utf-8'));
  writeFileSync(join(csvDir, `${id}.csv`), csv);
}

export function markdownTablesToCsv(md: string): string {
  // Naive markdown-table to CSV. Source files in this benchmark only
  // contain pipe-tables; other inputs are not in scope for v1.
  const rows: string[][] = [];
  for (const rawLine of md.split('\n')) {
    const line = rawLine.trim();
    const isTable = line.startsWith('|') && line.endsWith('|');
    if (!isTable) continue;
    if (/^\|\s*[-:]+/.test(line)) continue; // separator row
    const cells = line.slice(1, -1).split('|').map((c) => c.trim());
    rows.push(cells);
  }
  return rows.map((r) => r.map(escCsv).join(',')).join('\n') + '\n';
}

function escCsv(s: string): string {
  if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

async function main(): Promise<void> {
  if (!hasPandoc()) {
    console.error('pandoc not installed — install with `brew install pandoc` (macOS) or your distro equivalent');
    process.exit(1);
  }
  const sourceDir = join(ROOT, 'documents/source');
  const outRoot = join(ROOT, 'documents/rendered');
  const sources = readdirSync(sourceDir).filter((f) => f.endsWith('.md'));
  console.log(`[render] ${sources.length} source documents`);
  for (const f of sources) {
    await renderFact(join(sourceDir, f), outRoot);
  }
  console.log(`[done] rendered to ${outRoot}`);
}

if (process.argv[1]?.endsWith('render-docs.ts')) {
  main().catch((err: unknown) => {
    console.error(err);
    process.exit(1);
  });
}
