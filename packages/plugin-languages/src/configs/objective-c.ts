/**
 * Objective-C language configuration
 */
import type { GenericLanguageConfig } from '@codegraph/plugin-generic';

export const objectiveCConfig: Omit<GenericLanguageConfig, 'grammar'> = {
  id: 'objc',
  displayName: 'Objective-C',
  extensions: ['.m', '.h'],

  nodeTypes: {
    functions: ['function_definition', 'method_definition'],
    classes: ['class_interface', 'class_implementation'],
    interfaces: ['protocol_declaration'],
    variables: ['declaration'],
    imports: ['preproc_import', 'preproc_include'],
    calls: ['call_expression', 'message_expression'],
  },

  fields: {
    name: 'declarator',
    parameters: 'parameters',
    body: 'body',
    superclass: 'superclass',
    callee: 'function',
  },

  visibilityConfig: {
    strategy: 'modifier',
    exportedModifiers: ['public'],
  },

  docstringConfig: {
    strategy: 'preceding-comment',
    commentNodeTypes: ['comment'],
    stripPrefixes: ['/**', '*', '///', '//'],
  },

  paramConfig: {
    identifierNodeTypes: ['identifier'],
    typedParamNodeTypes: ['parameter_declaration'],
    typeField: 'type',
    defaultParamNodeTypes: [],
    filterNames: [],
  },

  importConfig: {
    moduleNodeTypes: ['string_literal', 'system_lib_string'],
    stripQuotes: true,
  },
};
