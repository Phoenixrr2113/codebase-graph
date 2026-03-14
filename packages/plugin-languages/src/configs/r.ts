/**
 * R language configuration
 */
import type { GenericLanguageConfig } from '@codegraph/plugin-generic';

export const rConfig: Omit<GenericLanguageConfig, 'grammar'> = {
  id: 'r',
  displayName: 'R',
  extensions: ['.r', '.R', '.rmd'],

  nodeTypes: {
    functions: ['function_definition'],
    classes: [],
    variables: ['left_assignment', 'right_assignment', 'equals_assignment'],
    imports: ['call'],  // library() and require() are calls
    calls: ['call'],
  },

  fields: {
    name: 'name',
    parameters: 'parameters',
    body: 'body',
  },

  visibilityConfig: {
    strategy: 'all-public',
  },

  docstringConfig: {
    strategy: 'preceding-comment',
    commentNodeTypes: ['comment'],
    stripPrefixes: ['#', "#'"],
  },

  paramConfig: {
    identifierNodeTypes: ['identifier'],
    typedParamNodeTypes: [],
    defaultParamNodeTypes: [],
    filterNames: [],
  },

  importConfig: {
    moduleNodeTypes: ['string'],
    stripQuotes: true,
  },
};
