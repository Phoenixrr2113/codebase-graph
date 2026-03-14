/**
 * Perl language configuration
 */
import type { GenericLanguageConfig } from '@codegraph/plugin-generic';

export const perlConfig: Omit<GenericLanguageConfig, 'grammar'> = {
  id: 'perl',
  displayName: 'Perl',
  extensions: ['.pl', '.pm', '.t'],

  nodeTypes: {
    functions: ['subroutine_declaration_statement', 'function_definition'],
    classes: ['package_statement'],
    interfaces: [],
    variables: ['variable_declaration'],
    imports: ['use_statement', 'require_statement'],
    calls: ['function_call_expression', 'method_call_expression'],
  },

  fields: {
    name: 'name',
    parameters: 'prototype',
    body: 'body',
    callee: 'function',
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
    identifierNodeTypes: ['scalar_variable'],
    typedParamNodeTypes: [],
    defaultParamNodeTypes: [],
    filterNames: [],
  },

  importConfig: {
    moduleNodeTypes: ['package_name', 'string_literal'],
    stripQuotes: true,
  },
};
