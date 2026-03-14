/**
 * Elixir language configuration
 */
import type { GenericLanguageConfig } from '@codegraph/plugin-generic';

export const elixirConfig: Omit<GenericLanguageConfig, 'grammar'> = {
  id: 'elixir',
  displayName: 'Elixir',
  extensions: ['.ex', '.exs'],

  nodeTypes: {
    functions: ['call'],  // def/defp are macro calls in Elixir's tree-sitter
    classes: ['call'],    // defmodule is a macro call
    interfaces: [],
    variables: [],
    imports: ['call'],    // import/use/require are macro calls
    calls: ['call'],
  },

  fields: {
    name: 'target',
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
    identifierNodeTypes: ['identifier'],
    typedParamNodeTypes: [],
    defaultParamNodeTypes: [],
    filterNames: [],
  },

  importConfig: {
    moduleNodeTypes: ['alias', 'atom'],
    stripQuotes: false,
  },
};
