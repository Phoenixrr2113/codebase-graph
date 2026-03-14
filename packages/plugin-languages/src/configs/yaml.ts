/**
 * YAML language configuration
 * Minimal entity extraction — mostly file-level metadata
 */
import type { GenericLanguageConfig } from '@codegraph/plugin-generic';

export const yamlConfig: Omit<GenericLanguageConfig, 'grammar'> = {
  id: 'yaml',
  displayName: 'YAML',
  extensions: ['.yml', '.yaml'],

  nodeTypes: {
    functions: [],
    classes: [],
    variables: ['block_mapping_pair'],
    imports: [],
  },

  fields: {
    name: 'key',
  },

  visibilityConfig: {
    strategy: 'all-public',
  },

  docstringConfig: {
    strategy: 'preceding-comment',
    commentNodeTypes: ['comment'],
    stripPrefixes: ['#'],
  },

  paramConfig: {
    identifierNodeTypes: [],
    typedParamNodeTypes: [],
    defaultParamNodeTypes: [],
    filterNames: [],
  },

  importConfig: {
    moduleNodeTypes: [],
    stripQuotes: false,
  },
};
