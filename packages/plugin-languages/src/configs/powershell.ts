/**
 * PowerShell language configuration
 */
import type { GenericLanguageConfig } from '@codegraph/plugin-generic';

export const powershellConfig: Omit<GenericLanguageConfig, 'grammar'> = {
  id: 'powershell',
  displayName: 'PowerShell',
  extensions: ['.ps1', '.psm1', '.psd1'],

  nodeTypes: {
    functions: ['function_statement'],
    classes: ['class_statement', 'enum_statement'],
    interfaces: [],
    variables: ['assignment_expression'],
    imports: ['using_statement'],
    calls: ['command_expression', 'invocation_expression'],
  },

  fields: {
    name: 'name',
    parameters: 'parameters',
    body: 'body',
    callee: 'command_name',
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
    identifierNodeTypes: ['variable', 'simple_variable'],
    typedParamNodeTypes: ['parameter'],
    typeField: 'type',
    defaultParamNodeTypes: [],
    filterNames: [],
  },

  importConfig: {
    moduleNodeTypes: ['string_literal', 'bareword_string'],
    stripQuotes: true,
  },
};
