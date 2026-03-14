/**
 * Dart language configuration
 */
import type { GenericLanguageConfig } from '@codegraph/plugin-generic';

export const dartConfig: Omit<GenericLanguageConfig, 'grammar'> = {
  id: 'dart',
  displayName: 'Dart',
  extensions: ['.dart'],

  nodeTypes: {
    functions: ['function_signature', 'method_signature', 'function_body'],
    classes: ['class_definition'],
    interfaces: ['class_definition'], // Dart uses abstract class as interface
    variables: ['initialized_variable_definition'],
    imports: ['import_or_export'],
    types: ['type_alias', 'enum_declaration'],
    calls: ['function_expression_invocation'],
  },

  fields: {
    name: 'name',
    parameters: 'formal_parameter_list',
    returnType: 'type',
    body: 'body',
    superclass: 'superclass',
  },

  visibilityConfig: {
    strategy: 'naming',
    privatePrefix: '_',
  },

  docstringConfig: {
    strategy: 'preceding-comment',
    commentNodeTypes: ['comment', 'documentation_comment'],
    stripPrefixes: ['///', '//'],
  },

  paramConfig: {
    identifierNodeTypes: ['identifier'],
    typedParamNodeTypes: ['formal_parameter'],
    defaultParamNodeTypes: ['default_formal_parameter'],
    filterNames: [],
    typeField: 'type',
  },

  importConfig: {
    moduleNodeTypes: ['string_literal'],
    stripQuotes: true,
  },
};
