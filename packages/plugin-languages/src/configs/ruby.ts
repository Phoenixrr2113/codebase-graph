/**
 * Ruby language configuration
 */
import type { GenericLanguageConfig } from '@codegraph/plugin-generic';

export const rubyConfig: Omit<GenericLanguageConfig, 'grammar'> = {
  id: 'ruby',
  displayName: 'Ruby',
  extensions: ['.rb', '.rake', '.gemspec'],

  nodeTypes: {
    functions: ['method', 'singleton_method'],
    classes: ['class', 'module'],
    interfaces: [],
    variables: ['assignment'],
    imports: ['call'], // require/require_relative are method calls
    calls: ['call', 'method_call'],
  },

  fields: {
    name: 'name',
    parameters: 'parameters',
    body: 'body',
    superclass: 'superclass',
    callee: 'method',
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
    identifierNodeTypes: ['identifier', 'simple_symbol'],
    typedParamNodeTypes: [],
    defaultParamNodeTypes: ['optional_parameter'],
    filterNames: [],
  },

  importConfig: {
    // Ruby's require/require_relative are method calls with string args
    moduleNodeTypes: ['string', 'string_content'],
    stripQuotes: true,
  },
};
