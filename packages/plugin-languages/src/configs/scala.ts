/**
 * Scala language configuration
 */
import type { GenericLanguageConfig } from '@codegraph/plugin-generic';

export const scalaConfig: Omit<GenericLanguageConfig, 'grammar'> = {
  id: 'scala',
  displayName: 'Scala',
  extensions: ['.scala', '.sc'],

  nodeTypes: {
    functions: ['function_definition', 'val_definition'],
    classes: ['class_definition', 'object_definition'],
    interfaces: ['trait_definition'],
    variables: ['var_definition', 'val_definition'],
    imports: ['import_declaration'],
    types: ['type_definition'],
    calls: ['call_expression'],
  },

  fields: {
    name: 'name',
    parameters: 'parameters',
    returnType: 'return_type',
    body: 'body',
    superclass: 'extends_clause',
  },

  visibilityConfig: {
    strategy: 'modifier',
    modifierNodeTypes: ['modifiers', 'access_modifier'],
    exportedModifiers: ['public'],
    abstractModifier: 'abstract',
  },

  docstringConfig: {
    strategy: 'preceding-comment',
    commentNodeTypes: ['comment', 'block_comment'],
    stripPrefixes: ['/**', '*/', '*', '//'],
  },

  paramConfig: {
    identifierNodeTypes: ['identifier'],
    typedParamNodeTypes: ['parameter'],
    defaultParamNodeTypes: ['parameter'],
    filterNames: [],
    typeField: 'type',
  },

  importConfig: {
    moduleNodeTypes: ['stable_identifier', 'identifier'],
    stripQuotes: false,
  },
};
