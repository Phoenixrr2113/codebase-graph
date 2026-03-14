/**
 * TOML language configuration
 * Minimal entity extraction — mostly file-level metadata
 */
import type { GenericLanguageConfig } from '@codegraph/plugin-generic';

export const tomlConfig: Omit<GenericLanguageConfig, 'grammar'> = {
  id: 'toml',
  displayName: 'TOML',
  extensions: ['.toml'],

  nodeTypes: {
    functions: [],
    classes: [],
    variables: ['pair'],
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
