import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';

const __dirname = dirname(fileURLToPath(import.meta.url));
const KDIR = join(__dirname, '../corpora/knowledge');

const FrontmatterSchema = z.object({
  id: z.string().regex(/^knowledge-\d{3}$/),
  title: z.string(),
  author: z.string().email(),
  valid_at: z.string().datetime(),
  invalid_at: z.string().datetime().optional(),
  references: z.array(z.string()).min(1),
  category: z.enum(['meeting-notes', 'spec', 'ticket', 'decision']),
});

function parseFrontmatter(md: string): unknown {
  const match = md.match(/^---\n([\s\S]*?)\n---/);
  if (!match) throw new Error('no frontmatter');
  // Naive YAML parse — sufficient for our schema (no nested arrays beyond `references`).
  const yaml = match[1]!;
  const obj: Record<string, unknown> = {};
  let inRefs = false;
  const refs: string[] = [];
  for (const line of yaml.split('\n')) {
    if (inRefs && line.startsWith('  - ')) { refs.push(line.slice(4).trim()); continue; }
    if (line.startsWith('references:')) { inRefs = true; continue; }
    inRefs = false;
    const m = line.match(/^([a-z_]+):\s*(.*)$/);
    if (m) obj[m[1]!] = m[2]!.trim();
  }
  if (refs.length > 0) obj['references'] = refs;
  return obj;
}

describe('knowledge corpus', () => {
  const files = readdirSync(KDIR).filter((f) => f.match(/^knowledge-\d{3}\.md$/));

  it('has at least 8 docs', () => {
    expect(files.length).toBeGreaterThanOrEqual(8);
  });

  it('every doc has valid frontmatter', () => {
    for (const f of files) {
      const md = readFileSync(join(KDIR, f), 'utf-8');
      const fm = parseFrontmatter(md);
      expect(() => FrontmatterSchema.parse(fm)).not.toThrow();
    }
  });

  it('at least one doc has invalid_at set (supersession pair)', () => {
    let hasSupersession = false;
    for (const f of files) {
      const md = readFileSync(join(KDIR, f), 'utf-8');
      const fm = FrontmatterSchema.parse(parseFrontmatter(md));
      if (fm.invalid_at) { hasSupersession = true; break; }
    }
    expect(hasSupersession).toBe(true);
  });

  it('uses at least 3 distinct authors', () => {
    const authors = new Set<string>();
    for (const f of files) {
      const fm = FrontmatterSchema.parse(parseFrontmatter(readFileSync(join(KDIR, f), 'utf-8')));
      authors.add(fm.author);
    }
    expect(authors.size).toBeGreaterThanOrEqual(3);
  });
});
