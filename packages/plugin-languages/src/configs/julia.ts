/**
 * Julia language configuration
 */
import type { GenericLanguageConfig } from '@codegraph/plugin-generic';

export const juliaConfig: Omit<GenericLanguageConfig, 'grammar'> = {
  id: 'julia',
  displayName: 'Julia',
  extensions: ['.jl'],

  nodeTypes: {
    functions: ['function_definition', 'short_function_definition'],
    classes: ['struct_definition', 'abstract_definition'],
    interfaces: [],
    variables: ['assignment', 'const_statement'],
    imports: ['import_statement', 'using_statement'],
    calls: ['call_expression'],
  },

  fields: {
    name: 'name',
    parameters: 'parameters',
    body: 'body',
    superclass: 'supertype',
    callee: 'callee',
  },

  visibilityConfig: {
    strategy: 'all-public',
  },

  docstringConfig: {
    strategy: 'preceding-comment',
    commentNodeTypes: ['line_comment', 'block_comment', 'string_literal'],
    stripPrefixes: ['#'],
  },

  paramConfig: {
    identifierNodeTypes: ['identifier'],
    typedParamNodeTypes: ['typed_parameter'],
    typeField: 'type',
    defaultParamNodeTypes: ['optional_parameter'],
    filterNames: [],
  },

  importConfig: {
    moduleNodeTypes: ['identifier', 'scoped_identifier'],
    stripQuotes: false,
  },
};
