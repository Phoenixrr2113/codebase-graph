/**
 * CSS language configuration
 * Minimal entity extraction
 */
import type { GenericLanguageConfig } from '@codegraph/plugin-generic';

export const cssConfig: Omit<GenericLanguageConfig, 'grammar'> = {
  id: 'css',
  displayName: 'CSS',
  extensions: ['.css'],

  nodeTypes: {
    functions: [],
    classes: [],
    variables: ['declaration'],
    imports: ['import_statement'],
  },

  fields: {
    name: 'name',
  },

  visibilityConfig: {
    strategy: 'all-public',
  },

  docstringConfig: {
    strategy: 'preceding-comment',
    commentNodeTypes: ['comment'],
    stripPrefixes: ['/**', '*/', '*'],
  },

  paramConfig: {
    identifierNodeTypes: [],
    typedParamNodeTypes: [],
    defaultParamNodeTypes: [],
    filterNames: [],
  },

  importConfig: {
    moduleNodeTypes: ['string_value'],
    stripQuotes: true,
  },
};
