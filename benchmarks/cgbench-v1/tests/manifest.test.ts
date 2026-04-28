import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ManifestSchema = z.object({
  version: z.literal('1'),
  corpora: z.array(
    z.object({
      name: z.string(),
      language: z.enum(['python', 'typescript', 'go', 'rust']),
      url: z.string().url(),
      commitSha: z.string().regex(/^[0-9a-f]{40}$/),
      license: z.string(),
    }),
  ).length(4),
});

describe('manifest.json', () => {
  it('is valid', () => {
    const __dirname = dirname(fileURLToPath(import.meta.url));
    const manifestPath = join(__dirname, '../corpora/code/manifest.json');
    const data = JSON.parse(readFileSync(manifestPath, 'utf-8'));
    expect(() => ManifestSchema.parse(data)).not.toThrow();
  });

  it('has one corpus per language', () => {
    const __dirname = dirname(fileURLToPath(import.meta.url));
    const manifestPath = join(__dirname, '../corpora/code/manifest.json');
    const data = ManifestSchema.parse(
      JSON.parse(readFileSync(manifestPath, 'utf-8')),
    );
    const langs = data.corpora.map((c) => c.language);
    expect(new Set(langs)).toEqual(new Set(['python', 'typescript', 'go', 'rust']));
  });
});
