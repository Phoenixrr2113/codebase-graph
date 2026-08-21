/**
 * PARENT_SECTION graph writes (batch-three edge-truthfulness fix set).
 *
 * `buildSectionHierarchy` in @codegraph/plugin-markdown computed the right
 * (parent, child) pairs but had no call site, so `ExtractedDocumentEntities`
 * never carried this data and `batchUpsertDocuments` never wrote a
 * PARENT_SECTION edge. This covers the write side: given a document's
 * `sectionHierarchy` field (as @codegraph/plugin-markdown now populates it),
 * `batchUpsertDocuments` creates the corresponding Section -> Section
 * PARENT_SECTION edges, matched by (filePath, startLine) the same way
 * BATCH_UPSERT_SECTIONS identifies Section nodes.
 *
 * Uses the embedded FalkorDBLite driver (no Docker, no port 6379).
 */

import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createClient, type GraphClient } from '../client';
import { createOperations, type GraphOperations } from '../operations';
import type { ExtractedDocumentEntities, MarkdownDocumentEntity, SectionEntity } from '@codegraph/types';

let falkordbliteAvailable = false;
try {
  await import('falkordblite');
  falkordbliteAvailable = true;
} catch {
  // not installed
}

const describeIfAvailable = falkordbliteAvailable ? describe : describe.skip;

const DOC_PATH = '/proj/guide.md';

function makeDocument(): MarkdownDocumentEntity {
  return {
    path: DOC_PATH,
    name: 'guide.md',
    title: 'Guide',
    frontmatter: {},
    hash: 'hash',
    lastModified: '2025-01-01T00:00:00Z',
  };
}

function makeSection(heading: string, level: number, startLine: number): SectionEntity {
  return { heading, level, filePath: DOC_PATH, startLine, endLine: startLine };
}

describeIfAvailable('PARENT_SECTION edge creation', () => {
  let client: GraphClient;
  let ops: GraphOperations;
  let dataDir: string;

  beforeAll(async () => {
    dataDir = await mkdtemp(join(tmpdir(), 'codegraph-parent-section-'));
    client = await createClient({
      driver: 'falkordblite',
      databasePath: dataDir,
      graphName: `test_parent_section_${Date.now()}`,
    });
    await client.ensureIndexes({ embeddingDim: 768 });
    ops = createOperations(client);
  }, 30_000);

  beforeEach(async () => {
    await client.query('MATCH (n) DETACH DELETE n', { params: {} });
  });

  afterAll(async () => {
    if (client) {
      try { await client.query('MATCH (n) DETACH DELETE n', { params: {} }); } catch { /* ok */ }
      await client.close();
    }
    try { await rm(dataDir, { recursive: true, force: true }); } catch { /* best effort */ }
  }, 15_000);

  it('creates PARENT_SECTION edges for nested headings and none for root-level ones', async () => {
    const guide = makeSection('Guide', 1, 1);
    const setup = makeSection('Setup', 2, 3);
    const prerequisites = makeSection('Prerequisites', 3, 5);
    const usage = makeSection('Usage', 2, 7);

    const doc: ExtractedDocumentEntities = {
      document: makeDocument(),
      sections: [guide, setup, prerequisites, usage],
      codeBlocks: [],
      links: [],
      sectionHierarchy: [
        { parentStartLine: guide.startLine, childStartLine: setup.startLine },
        { parentStartLine: setup.startLine, childStartLine: prerequisites.startLine },
        { parentStartLine: guide.startLine, childStartLine: usage.startLine },
      ],
    };

    await ops.batchUpsertDocuments([doc]);

    const edges = await client.roQuery<{ parentHeading: string; childHeading: string }>(
      `MATCH (p:Section)-[:PARENT_SECTION]->(c:Section)
       WHERE p.filePath = $path
       RETURN p.heading AS parentHeading, c.heading AS childHeading
       ORDER BY c.startLine`,
      { params: { path: DOC_PATH } },
    );

    expect(edges.data).toEqual([
      { parentHeading: 'Guide', childHeading: 'Setup' },
      { parentHeading: 'Setup', childHeading: 'Prerequisites' },
      { parentHeading: 'Guide', childHeading: 'Usage' },
    ]);

    // Guide (the document's root H1) is never a child of anything.
    const guideAsChild = await client.roQuery<{ count: number }>(
      `MATCH ()-[:PARENT_SECTION]->(c:Section {heading: 'Guide'}) RETURN count(*) AS count`,
      { params: {} },
    );
    expect(guideAsChild.data[0]!.count).toBe(0);
  });

  it('produces no PARENT_SECTION edges when the document has no hierarchy (flat headings)', async () => {
    const one = makeSection('One', 1, 1);
    const two = makeSection('Two', 1, 5);

    const doc: ExtractedDocumentEntities = {
      document: makeDocument(),
      sections: [one, two],
      codeBlocks: [],
      links: [],
      sectionHierarchy: [],
    };

    await ops.batchUpsertDocuments([doc]);

    const edges = await client.roQuery<{ count: number }>(
      `MATCH (:Section)-[r:PARENT_SECTION]->(:Section) WHERE startNode(r).filePath = $path RETURN count(r) AS count`,
      { params: { path: DOC_PATH } },
    );
    expect(edges.data[0]!.count).toBe(0);

    // Both headings still exist as Section nodes, attached via CONTAINS.
    const sections = await client.roQuery<{ count: number }>(
      `MATCH (:MarkdownDocument {path: $path})-[:CONTAINS]->(:Section) RETURN count(*) AS count`,
      { params: { path: DOC_PATH } },
    );
    expect(sections.data[0]!.count).toBe(2);
  });

  it('a PARENT_SECTION pair referencing a startLine with no matching Section drops silently', async () => {
    const guide = makeSection('Guide', 1, 1);

    const doc: ExtractedDocumentEntities = {
      document: makeDocument(),
      sections: [guide],
      codeBlocks: [],
      links: [],
      // childStartLine 99 has no corresponding Section in `sections` above.
      sectionHierarchy: [{ parentStartLine: guide.startLine, childStartLine: 99 }],
    };

    await ops.batchUpsertDocuments([doc]);

    const edges = await client.roQuery<{ count: number }>(
      `MATCH (:Section)-[r:PARENT_SECTION]->(:Section) WHERE startNode(r).filePath = $path RETURN count(r) AS count`,
      { params: { path: DOC_PATH } },
    );
    expect(edges.data[0]!.count).toBe(0);
  });
});
