/**
 * Swift language configuration
 */
import type { GenericLanguageConfig } from '@codegraph/plugin-generic';

export const swiftConfig: Omit<GenericLanguageConfig, 'grammar'> = {
  id: 'swift',
  displayName: 'Swift',
  extensions: ['.swift'],

  nodeTypes: {
    functions: ['function_declaration', 'init_declaration'],
    classes: ['class_declaration', 'struct_declaration', 'enum_declaration'],
    interfaces: ['protocol_declaration'],
    variables: ['property_declaration', 'constant_declaration'],
    imports: ['import_declaration'],
    types: ['typealias_declaration'],
    calls: ['call_expression'],
  },

  fields: {
    name: 'name',
    parameters: 'parameters',
    returnType: 'return_type',
    body: 'body',
    superclass: 'inheritance_specifier',
  },

  visibilityConfig: {
    strategy: 'modifier',
    modifierNodeTypes: ['modifier'],
    exportedModifiers: ['public', 'open'],
    asyncModifier: 'async',
    abstractModifier: 'abstract',
  },

  docstringConfig: {
    strategy: 'preceding-comment',
    commentNodeTypes: ['comment', 'multiline_comment'],
    stripPrefixes: ['///', '//', '/**', '*/', '*'],
  },

  paramConfig: {
    identifierNodeTypes: ['simple_identifier'],
    typedParamNodeTypes: ['parameter'],
    defaultParamNodeTypes: ['parameter'],
    filterNames: [],
    typeField: 'type',
  },

  importConfig: {
    moduleNodeTypes: ['identifier'],
    stripQuotes: false,
  },
};
