import { describe, expect, it } from 'vitest';
import type { AllGraphLabel, EdgeLabel } from '@codegraph/types';

import { queryPersonaDefinition } from '../personas/query';
import { personaToolDefinitions } from '../personas';

const edgeLabels = [
  'CONTAINS',
  'IMPORTS',
  'IMPORTS_SYMBOL',
  'CALLS',
  'EXTENDS',
  'IMPLEMENTS',
  'USES_TYPE',
  'RETURNS',
  'HAS_PARAM',
  'HAS_METHOD',
  'HAS_PROPERTY',
  'RENDERS',
  'INTRODUCED_IN',
  'MODIFIED_IN',
  'DELETED_IN',
  'EXPORTS',
  'PARENT_SECTION',
  'ABOUT',
] as const satisfies readonly EdgeLabel[];

const removedEdgeLabels = ['INSTANTIATES', 'HAS_SECTION', 'CONTAINS_CODE', 'LINKS_TO'] as const;

const nodeLabels = [
  'File',
  'Function',
  'Class',
  'Interface',
  'Variable',
  'Type',
  'Component',
  'TypeRef',
  'Entity',
  'Project',
  'Commit',
  'Metadata',
  'MarkdownDocument',
  'Section',
  'CodeBlock',
  'Link',
] as const satisfies readonly AllGraphLabel[];

describe('query persona - edge type description matches schema', () => {
  it('lists every current EdgeLabel and none of the removed edge labels', () => {
    const edgeTypesLine = queryPersonaDefinition.description.match(/^Edge types: (.+)$/m);
    expect(edgeTypesLine).not.toBeNull();

    const documentedEdgeLabels = edgeTypesLine?.[1].split(', ') ?? [];
    const knownEdgeLabels = new Set<string>(edgeLabels);

    for (const label of documentedEdgeLabels) {
      expect(knownEdgeLabels.has(label), `${label} is not an EdgeLabel`).toBe(true);
    }
    expect(documentedEdgeLabels).toEqual(edgeLabels);

    for (const removedLabel of removedEdgeLabels) {
      expect(queryPersonaDefinition.description).not.toContain(removedLabel);
    }
  });

  it('points callers at the registered analyze persona', () => {
    expect(queryPersonaDefinition.description).toContain('Use search and analyze for most tasks.');
    expect(personaToolDefinitions.map((tool) => tool.name)).toContain('analyze');
  });

  it('lists every materialized graph node label and no phantom Import node', () => {
    const nodeLabelsLine = queryPersonaDefinition.description.match(/^Node labels: (.+)$/m);
    expect(nodeLabelsLine).not.toBeNull();
    expect(nodeLabelsLine?.[1].split(', ')).toEqual(nodeLabels);
    expect(nodeLabelsLine?.[1].split(', ')).not.toContain('Import');
  });
});
