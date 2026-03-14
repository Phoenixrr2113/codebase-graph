/**
 * Lua language configuration
 */
import type { GenericLanguageConfig } from '@codegraph/plugin-generic';

export const luaConfig: Omit<GenericLanguageConfig, 'grammar'> = {
  id: 'lua',
  displayName: 'Lua',
  extensions: ['.lua'],

  nodeTypes: {
    functions: ['function_declaration', 'local_function'],
    classes: [],
    variables: ['variable_declaration', 'local_variable_declaration'],
    imports: [],  // Lua uses require() which is a function call
    calls: ['function_call'],
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
    stripPrefixes: ['--', '---'],
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
