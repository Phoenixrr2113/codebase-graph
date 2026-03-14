/**
 * JSON language configuration
 * Minimal entity extraction — primarily file-level metadata
 */
import type { GenericLanguageConfig } from '@codegraph/plugin-generic';

export const jsonConfig: Omit<GenericLanguageConfig, 'grammar'> = {
  id: 'json',
  displayName: 'JSON',
  extensions: ['.json', '.jsonc', '.json5'],

  nodeTypes: {
    functions: [],
    classes: [],
    interfaces: [],
    variables: ['pair'],
    imports: [],
    calls: [],
  },

  fields: {
    name: 'key',
  },

  visibilityConfig: {
    strategy: 'all-public',
  },

  docstringConfig: {
    strategy: 'none',
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
