/**
 * C++ language configuration
 */
import type { GenericLanguageConfig } from '@codegraph/plugin-generic';

export const cppConfig: Omit<GenericLanguageConfig, 'grammar'> = {
  id: 'cpp',
  displayName: 'C++',
  extensions: ['.cpp', '.cc', '.cxx', '.hpp', '.hh', '.hxx', '.h++'],

  nodeTypes: {
    functions: ['function_definition'],
    classes: ['class_specifier', 'struct_specifier'],
    interfaces: [],
    variables: ['declaration'],
    imports: ['preproc_include'],
    types: ['type_definition', 'enum_specifier', 'alias_declaration'],
    calls: ['call_expression'],
  },

  fields: {
    name: 'declarator',
    parameters: 'parameters',
    returnType: 'type',
    body: 'body',
    superclass: 'base_class_clause',
  },

  visibilityConfig: {
    strategy: 'modifier',
    modifierNodeTypes: ['access_specifier'],
    exportedModifiers: ['public'],
    abstractModifier: 'virtual',
  },

  docstringConfig: {
    strategy: 'preceding-comment',
    commentNodeTypes: ['comment'],
    stripPrefixes: ['/**', '*/', '*', '///', '//'],
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
