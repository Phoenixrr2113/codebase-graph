import { describe, expect, it, beforeAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { ManifestSchema } from '../src/types.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const manifestPath = join(__dirname, '../corpora/code/manifest.json');

describe('manifest.json', () => {
  let raw: unknown;
  beforeAll(() => {
    raw = JSON.parse(readFileSync(manifestPath, 'utf-8'));
  });

  it('manifest.json conforms to ManifestSchema', () => {
    expect(() => ManifestSchema.parse(raw)).not.toThrow();
  });

  it('has one corpus per language', () => {
    const data = ManifestSchema.parse(raw);
    const langs = data.corpora.map((c) => c.language);
    expect(new Set(langs)).toEqual(new Set(['python', 'typescript', 'go', 'rust']));
  });
});

describe('ManifestSchema rejection cases', () => {
  const validEntry = {
    name: 'x',
    language: 'python' as const,
    url: 'https://example.com/x.git',
    commitSha: '0123456789abcdef0123456789abcdef01234567',
    license: 'MIT',
  };

  it('rejects wrong version literal', () => {
    expect(() =>
      ManifestSchema.parse({ version: '2', corpora: Array(4).fill(validEntry) }),
    ).toThrow();
  });

  it('rejects fewer than 4 corpora', () => {
    expect(() =>
      ManifestSchema.parse({ version: '1', corpora: Array(3).fill(validEntry) }),
    ).toThrow();
  });

  it('rejects more than 4 corpora', () => {
    expect(() =>
      ManifestSchema.parse({ version: '1', corpora: Array(5).fill(validEntry) }),
    ).toThrow();
  });

  it('rejects non-40-char SHA', () => {
    const bad = { ...validEntry, commitSha: '0123456789abcdef' };
    expect(() =>
      ManifestSchema.parse({ version: '1', corpora: [bad, validEntry, validEntry, validEntry] }),
    ).toThrow();
  });

  it('rejects uppercase hex in SHA', () => {
    const bad = { ...validEntry, commitSha: '0123456789ABCDEF0123456789ABCDEF01234567' };
    expect(() =>
      ManifestSchema.parse({ version: '1', corpora: [bad, validEntry, validEntry, validEntry] }),
    ).toThrow();
  });

  it('rejects missing license', () => {
    const { license: _, ...bad } = validEntry;
    expect(() =>
      ManifestSchema.parse({ version: '1', corpora: [bad, validEntry, validEntry, validEntry] }),
    ).toThrow();
  });
});
