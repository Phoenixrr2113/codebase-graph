/**
 * Erlang language configuration
 */
import type { GenericLanguageConfig } from '@codegraph/plugin-generic';

export const erlangConfig: Omit<GenericLanguageConfig, 'grammar'> = {
  id: 'erlang',
  displayName: 'Erlang',
  extensions: ['.erl', '.hrl'],

  nodeTypes: {
    functions: ['function'],
    classes: ['module_attribute'],
    interfaces: [],
    variables: [],
    imports: ['import_attribute'],
    calls: ['call'],
  },

  fields: {
    name: 'name',
    parameters: 'args',
    body: 'body',
    callee: 'function',
  },

  visibilityConfig: {
    strategy: 'all-public',
  },

  docstringConfig: {
    strategy: 'preceding-comment',
    commentNodeTypes: ['comment'],
    stripPrefixes: ['%'],
  },

  paramConfig: {
    identifierNodeTypes: ['variable', 'atom'],
    typedParamNodeTypes: [],
    defaultParamNodeTypes: [],
    filterNames: [],
  },

  importConfig: {
    moduleNodeTypes: ['atom'],
    stripQuotes: false,
  },
};
