/**
 * Bash/Shell language configuration
 */
import type { GenericLanguageConfig } from '@codegraph/plugin-generic';

export const bashConfig: Omit<GenericLanguageConfig, 'grammar'> = {
  id: 'bash',
  displayName: 'Bash',
  extensions: ['.sh', '.bash', '.zsh'],

  nodeTypes: {
    functions: ['function_definition'],
    classes: [],
    variables: ['variable_assignment'],
    imports: [], // source/. are commands, not imports
    calls: ['command'],
  },

  fields: {
    name: 'name',
    body: 'body',
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
    identifierNodeTypes: ['variable_name', 'word'],
    typedParamNodeTypes: [],
    defaultParamNodeTypes: [],
    filterNames: [],
  },

  importConfig: {
    moduleNodeTypes: ['string', 'word'],
    stripQuotes: false,
  },
};
