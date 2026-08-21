/**
 * PARENT_SECTION edge computation (batch-three edge-truthfulness fix set).
 *
 * `buildSectionHierarchy` existed in extractors/sections.ts but had zero
 * call sites: nothing ever wired its output into ExtractedDocumentEntities,
 * so no PARENT_SECTION edge was ever written even though the edge type was
 * declared in @codegraph/types and documented in this package's README.
 *
 * This covers `buildSectionHierarchy` in isolation (a synthetic section
 * list covering nesting, siblings, and multiple document-level roots), plus
 * its wiring into `parseMarkdownContent`'s `sectionHierarchy` field.
 */

import { describe, it, expect } from 'vitest';
import { extractSections, buildSectionHierarchy } from '../extractors/sections';
import { parseMarkdownContent } from '../index';
import type { SectionEntity } from '@codegraph/types';

function section(heading: string, level: number, startLine: number): SectionEntity {
  return { heading, level, filePath: '/doc.md', startLine, endLine: startLine };
}

describe('buildSectionHierarchy', () => {
  it('nests an H2 under the nearest preceding H1', () => {
    const sections = [section('Intro', 1, 1), section('Details', 2, 3)];
    expect(buildSectionHierarchy(sections)).toEqual([
      { parentStartLine: 1, childStartLine: 3 },
    ]);
  });

  it('gives the document root H1 no PARENT_SECTION edge', () => {
    const sections = [section('Intro', 1, 1)];
    expect(buildSectionHierarchy(sections)).toEqual([]);
  });

  it('nests a three-level chain (H1 > H2 > H3) correctly', () => {
    const sections = [
      section('Root', 1, 1),
      section('Mid', 2, 3),
      section('Leaf', 3, 5),
    ];
    expect(buildSectionHierarchy(sections)).toEqual([
      { parentStartLine: 1, childStartLine: 3 },
      { parentStartLine: 3, childStartLine: 5 },
    ]);
  });

  it('attaches sibling H2s to the same H1 parent, not to each other', () => {
    const sections = [
      section('Root', 1, 1),
      section('First', 2, 3),
      section('Second', 2, 6),
    ];
    expect(buildSectionHierarchy(sections)).toEqual([
      { parentStartLine: 1, childStartLine: 3 },
      { parentStartLine: 1, childStartLine: 6 },
    ]);
  });

  it('pops back to the correct ancestor after a deeper subtree ends', () => {
    // H1 -> H2 -> H3, then a second H2 sibling: the H3 must not become the
    // second H2's parent, it must pop back up to the H1.
    const sections = [
      section('Root', 1, 1),
      section('Branch A', 2, 3),
      section('Branch A Detail', 3, 5),
      section('Branch B', 2, 8),
    ];
    expect(buildSectionHierarchy(sections)).toEqual([
      { parentStartLine: 1, childStartLine: 3 },
      { parentStartLine: 3, childStartLine: 5 },
      { parentStartLine: 1, childStartLine: 8 },
    ]);
  });

  it('gives every top-level heading its own root, none linked to each other', () => {
    // Two H1s back to back: both are root-level, neither gets a PARENT_SECTION edge.
    const sections = [section('Part One', 1, 1), section('Part Two', 1, 10)];
    expect(buildSectionHierarchy(sections)).toEqual([]);
  });

  it('an H2 that appears before any H1 (no shallower ancestor yet) is root-level', () => {
    const sections = [section('Orphan', 2, 1), section('Root', 1, 5)];
    expect(buildSectionHierarchy(sections)).toEqual([]);
  });

  it('returns no edges for an empty section list', () => {
    expect(buildSectionHierarchy([])).toEqual([]);
  });
});

describe('buildSectionHierarchy wired through extractSections (real heading levels)', () => {
  it('matches extractSections output directly', async () => {
    const { parseMarkdown } = await import('../parser');
    const parsed = await parseMarkdown(
      [
        '# Guide',
        '',
        '## Setup',
        '',
        '### Prerequisites',
        '',
        '## Usage',
        '',
        '# Appendix',
        '',
      ].join('\n'),
    );
    const sections = extractSections(parsed.ast, '/guide.md');
    const hierarchy = buildSectionHierarchy(sections);

    const byHeading = new Map(sections.map((s) => [s.heading, s.startLine]));
    expect(hierarchy).toEqual([
      { parentStartLine: byHeading.get('Guide'), childStartLine: byHeading.get('Setup') },
      { parentStartLine: byHeading.get('Setup'), childStartLine: byHeading.get('Prerequisites') },
      { parentStartLine: byHeading.get('Guide'), childStartLine: byHeading.get('Usage') },
    ]);
    // "Appendix" is a second H1: root-level, no PARENT_SECTION edge, and no
    // edge exists pointing at it as a child anywhere in the result.
    expect(hierarchy.some((h) => h.childStartLine === byHeading.get('Appendix'))).toBe(false);
  });
});

describe('parseMarkdownContent: sectionHierarchy field', () => {
  it('returns the right PARENT_SECTION pairs for nested headings', async () => {
    const content = [
      '# Guide',
      '',
      'Intro text.',
      '',
      '## Setup',
      '',
      '### Prerequisites',
      '',
      '## Usage',
      '',
    ].join('\n');

    const result = await parseMarkdownContent(content, '/virtual/guide.md');

    expect(result.sections).toHaveLength(4);
    const byHeading = new Map(result.sections.map((s) => [s.heading, s.startLine]));

    expect(result.sectionHierarchy).toEqual([
      { parentStartLine: byHeading.get('Guide'), childStartLine: byHeading.get('Setup') },
      { parentStartLine: byHeading.get('Setup'), childStartLine: byHeading.get('Prerequisites') },
      { parentStartLine: byHeading.get('Guide'), childStartLine: byHeading.get('Usage') },
    ]);
  });

  it('produces no PARENT_SECTION edges when every heading is root-level (flat H1s)', async () => {
    const content = ['# One', '', '# Two', '', '# Three', ''].join('\n');

    const result = await parseMarkdownContent(content, '/virtual/flat.md');

    expect(result.sections).toHaveLength(3);
    expect(result.sectionHierarchy).toEqual([]);
  });

  it('produces no PARENT_SECTION edges for a document with no headings at all', async () => {
    const result = await parseMarkdownContent('Just a paragraph, no headings.\n', '/virtual/noheadings.md');

    expect(result.sections).toHaveLength(0);
    expect(result.sectionHierarchy).toEqual([]);
  });
});
