/**
 * C language configuration
 */
import type { GenericLanguageConfig } from '@codegraph/plugin-generic';

export const cConfig: Omit<GenericLanguageConfig, 'grammar'> = {
  id: 'c',
  displayName: 'C',
  extensions: ['.c', '.h'],

  nodeTypes: {
    functions: ['function_definition'],
    classes: ['struct_specifier'],
    interfaces: [],
    variables: ['declaration'],
    imports: ['preproc_include'],
    types: ['type_definition', 'enum_specifier'],
    calls: ['call_expression'],
  },

  fields: {
    name: 'declarator',
    parameters: 'parameters',
    returnType: 'type',
    body: 'body',
  },

  visibilityConfig: {
    strategy: 'all-public',
  },

  docstringConfig: {
    strategy: 'preceding-comment',
    commentNodeTypes: ['comment'],
    stripPrefixes: ['/**', '*/', '*', '//'],
  },

  paramConfig: {
    identifierNodeTypes: ['identifier'],
    typedParamNodeTypes: ['parameter_declaration'],
    defaultParamNodeTypes: [],
    filterNames: [],
    typeField: 'type',
  },

  importConfig: {
    moduleNodeTypes: ['string_literal', 'system_lib_string'],
    stripQuotes: true,
  },
};
