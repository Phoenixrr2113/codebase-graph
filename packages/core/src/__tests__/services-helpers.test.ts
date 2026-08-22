import { describe, it, expect } from 'vitest';
import { getLabelFromLabels, generateNodeId, ALL_LABELS } from '../services/helpers';
import { SYMBOL_LABELS, NODE_LABELS } from '@codegraph/types';

/**
 * getLabelFromLabels used to classify against a hand-copied 8-label allowlist
 * (the 7 embeddable code-symbol labels plus 'Import') instead of the full set
 * of real node labels. A Commit, MarkdownDocument, Section, CodeBlock or Link
 * node fell through the "not found" branch and defaulted to 'File', which
 * generateNodeId then turns into a nonsensical id built from a File-shaped
 * key on a node that has no filePath at all.
 *
 * This path is reachable only through CodeGraphService.getNodesPaginated
 * when a caller explicitly requests one of those types (e.g.
 * `types: ['Commit']`); it is exported but currently uncalled in production.
 * The fix widens classification to the full canonical NODE_LABELS set.
 */
describe('getLabelFromLabels', () => {
  it('classifies a Commit node as Commit, not File', () => {
    expect(getLabelFromLabels(['Commit'])).toBe('Commit');
  });

  it('classifies MarkdownDocument, Section, CodeBlock and Link correctly', () => {
    expect(getLabelFromLabels(['MarkdownDocument'])).toBe('MarkdownDocument');
    expect(getLabelFromLabels(['Section'])).toBe('Section');
    expect(getLabelFromLabels(['CodeBlock'])).toBe('CodeBlock');
    expect(getLabelFromLabels(['Link'])).toBe('Link');
  });

  it('still classifies every one of the original 8 recognized labels correctly', () => {
    for (const label of [...SYMBOL_LABELS, 'Import'] as const) {
      expect(getLabelFromLabels([label])).toBe(label);
    }
  });

  it('classifies every NODE_LABELS member', () => {
    for (const label of NODE_LABELS) {
      expect(getLabelFromLabels([label])).toBe(label);
    }
  });

  it('still falls back to File for a label list with no recognized NodeLabel value', () => {
    expect(getLabelFromLabels(['External'])).toBe('File');
    expect(getLabelFromLabels([])).toBe('File');
  });
});

/**
 * generateNodeId used to build every non-File id from the same
 * name/filePath/startLine-or-line scheme, regardless of label. That scheme
 * is the real identity for the seven symbol labels (see
 * packages/graph/src/schema.ts's MERGE keys and generateNodeId), but Commit,
 * MarkdownDocument, Section, CodeBlock, Link and Entity nodes carry none of
 * those properties, so every node of a given one of those labels collapsed
 * onto the exact same id (e.g. every Commit became "Commit::0").
 *
 * Real identity per label, confirmed against packages/graph/src/schema.ts
 * (CommitNodeProps, MarkdownDocumentNodeProps, SectionNodeProps,
 * CodeBlockNodeProps, LinkNodeProps) and the MERGE keys in
 * packages/graph/src/operations.ts (BATCH_UPSERT_* / commit upsert queries)
 * and packages/graph/src/knowledge-operations.ts (Entity upsert):
 *   - Commit: MERGE (c:Commit {hash})                          -> hash
 *   - MarkdownDocument: MERGE (d:MarkdownDocument {path})       -> path
 *   - Section: MERGE (s:Section {filePath, startLine})          -> filePath + startLine
 *   - CodeBlock: MERGE (cb:CodeBlock {filePath, startLine})     -> filePath + startLine
 *   - Link: MERGE (l:Link {filePath, line, target})             -> filePath + line + target
 *   - Entity: MERGE (n:Entity {text, type})                     -> text + type
 * The seven symbol labels (File, Function, Class, Interface, Variable,
 * Type, Component) keep the existing name/filePath/startLine-or-line scheme,
 * which already matches their own MERGE keys.
 */
describe('generateNodeId: Commit uses hash, not the name/filePath/line scheme', () => {
  // Real CommitNodeProps shape (packages/graph/src/schema.ts): hash, message,
  // author, email, date. Deliberately no `name` or `filePath` field, since a
  // real Commit node never carries either.
  const realCommitProps = (hash: string) => ({
    hash,
    message: 'fix: something',
    author: 'Randy Wilson',
    email: 'randy@example.com',
    date: '2026-08-20T00:00:00Z',
  });

  it('builds an id containing the commit hash, not a File-shaped id', () => {
    const label = getLabelFromLabels(['Commit']);
    const id = generateNodeId(label, realCommitProps('abc123'));
    expect(id).not.toMatch(/^File:/);
    expect(id).toContain('abc123');
  });

  it('gives two different Commit nodes two different ids', () => {
    const idA = generateNodeId('Commit', realCommitProps('aaa111'));
    const idB = generateNodeId('Commit', realCommitProps('bbb222'));
    expect(idA).not.toBe(idB);
  });
});

describe('generateNodeId: MarkdownDocument, Section, CodeBlock, Link use their real MERGE keys', () => {
  it('keys MarkdownDocument by path', () => {
    // Real MarkdownDocumentNodeProps shape: path, name, title, frontmatter, hash, lastModified.
    const idA = generateNodeId('MarkdownDocument', { path: '/docs/a.md', name: 'a.md', title: null, frontmatter: null, hash: 'h1', lastModified: '2026-01-01' });
    const idB = generateNodeId('MarkdownDocument', { path: '/docs/b.md', name: 'a.md', title: null, frontmatter: null, hash: 'h1', lastModified: '2026-01-01' });
    expect(idA).not.toBe(idB);
    expect(idA).toContain('/docs/a.md');
  });

  it('keys Section by filePath + startLine, not name (Sections have no name)', () => {
    // Real SectionNodeProps shape: heading, level, filePath, startLine, endLine.
    const idA = generateNodeId('Section', { heading: 'Intro', level: 1, filePath: '/docs/a.md', startLine: 1, endLine: 5 });
    const idB = generateNodeId('Section', { heading: 'Intro', level: 1, filePath: '/docs/a.md', startLine: 20, endLine: 25 });
    expect(idA).not.toBe(idB);
  });

  it('keys CodeBlock by filePath + startLine, not name (CodeBlocks have no name)', () => {
    // Real CodeBlockNodeProps shape: language, content, filePath, startLine, endLine.
    const idA = generateNodeId('CodeBlock', { language: 'ts', content: 'const a = 1;', filePath: '/docs/a.md', startLine: 3, endLine: 5 });
    const idB = generateNodeId('CodeBlock', { language: 'ts', content: 'const a = 1;', filePath: '/docs/a.md', startLine: 10, endLine: 12 });
    expect(idA).not.toBe(idB);
  });

  it('keys Link by filePath + line + target, not name (Links have no name)', () => {
    // Real LinkNodeProps shape: text, target, isInternal, filePath, line, anchor.
    const idA = generateNodeId('Link', { text: 'here', target: '/other.md', isInternal: true, filePath: '/docs/a.md', line: 4, anchor: null });
    const idB = generateNodeId('Link', { text: 'here', target: '/another.md', isInternal: true, filePath: '/docs/a.md', line: 4, anchor: null });
    expect(idA).not.toBe(idB);
  });
});

describe('generateNodeId: Entity uses text + type (its real MERGE key), reachable via getNeighborsImpl', () => {
  it('gives two different Entity nodes two different ids', () => {
    const idA = generateNodeId('Entity', { text: 'Acme Corp', type: 'Organization' });
    const idB = generateNodeId('Entity', { text: 'Beta Corp', type: 'Organization' });
    expect(idA).not.toBe(idB);
  });

  it('distinguishes same-text Entities of different types', () => {
    const idA = generateNodeId('Entity', { text: 'Acme', type: 'Organization' });
    const idB = generateNodeId('Entity', { text: 'Acme', type: 'Product' });
    expect(idA).not.toBe(idB);
  });
});

describe('generateNodeId: symbol labels expose persisted opaque ids', () => {
  it('returns the persisted id without rebuilding it from mutable location fields', () => {
    const persistedId = `sym:v1:${'a'.repeat(64)}`;
    const id = generateNodeId('Function', {
      id: persistedId,
      name: 'doThing',
      filePath: '/src/a.ts',
      startLine: 10,
    });
    expect(id).toBe(persistedId);
  });

  it('does not synthesize a location-based id when persisted identity is absent', () => {
    const id = generateNodeId('Function', { name: 'doThing', filePath: '/src/a.ts', startLine: 10 });
    expect(id).toBe('Function:unknown');
  });

  it('still builds the single-key File id', () => {
    expect(generateNodeId('File', { filePath: '/src/a.ts' })).toBe('File:/src/a.ts');
  });
});

describe('generateNodeId: a label with no established identity contract falls back to an explicit unknown marker', () => {
  it('marks Import (never materialized as a real node; see schema.ts, no MERGE for :Import) as unknown rather than guessing', () => {
    const id = generateNodeId('Import', { source: '../foo' });
    expect(id).toContain('unknown');
    expect(id).not.toMatch(/^Import::/);
  });
});

describe('ALL_LABELS', () => {
  it('matches SYMBOL_LABELS exactly', () => {
    expect([...ALL_LABELS].sort()).toEqual([...SYMBOL_LABELS].sort());
  });
});
