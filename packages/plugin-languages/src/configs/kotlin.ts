/**
 * Kotlin language configuration
 */
import type { GenericLanguageConfig } from '@codegraph/plugin-generic';

export const kotlinConfig: Omit<GenericLanguageConfig, 'grammar'> = {
  id: 'kotlin',
  displayName: 'Kotlin',
  extensions: ['.kt', '.kts'],

  nodeTypes: {
    functions: ['function_declaration'],
    classes: ['class_declaration', 'object_declaration'],
    interfaces: ['interface_declaration'],
    variables: ['property_declaration'],
    imports: ['import_header'],
    types: ['type_alias'],
    calls: ['call_expression'],
  },

  fields: {
    name: 'name',  // Kotlin uses simple_identifier for names
    parameters: 'value_parameters',
    returnType: 'type',
    body: 'body',
    superclass: 'delegation_specifiers',
    callee: 'expression',
  },

  visibilityConfig: {
    strategy: 'modifier',
    modifierNodeTypes: ['visibility_modifier'],
    exportedModifiers: ['public', 'internal'],
    asyncModifier: 'suspend',
    abstractModifier: 'abstract',
  },

  docstringConfig: {
    strategy: 'preceding-comment',
    commentNodeTypes: ['multiline_comment', 'comment'],
    stripPrefixes: ['/**', '*/', '*', '//'],
  },

  paramConfig: {
    identifierNodeTypes: ['simple_identifier'],
    typedParamNodeTypes: ['parameter'],
    defaultParamNodeTypes: ['parameter'], // Kotlin has defaults inline
    filterNames: [],
    typeField: 'type',
  },

  importConfig: {
    moduleNodeTypes: ['identifier', 'simple_identifier'],
    stripQuotes: false,
  },
};
