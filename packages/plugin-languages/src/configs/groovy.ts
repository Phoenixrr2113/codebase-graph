/**
 * Groovy language configuration
 */
import type { GenericLanguageConfig } from '@codegraph/plugin-generic';

export const groovyConfig: Omit<GenericLanguageConfig, 'grammar'> = {
  id: 'groovy',
  displayName: 'Groovy',
  extensions: ['.groovy', '.gradle', '.gvy', '.gy'],

  nodeTypes: {
    functions: ['method_declaration', 'function_definition'],
    classes: ['class_declaration', 'enum_declaration', 'interface_declaration'],
    interfaces: ['interface_declaration'],
    variables: ['variable_declaration'],
    imports: ['import_declaration'],
    calls: ['method_invocation', 'function_call'],
  },

  fields: {
    name: 'name',
    parameters: 'parameters',
    body: 'body',
    superclass: 'superclass',
    callee: 'name',
  },

  visibilityConfig: {
    strategy: 'modifier',
    exportedModifiers: ['public'],
  },

  docstringConfig: {
    strategy: 'preceding-comment',
    commentNodeTypes: ['comment', 'groovydoc_comment'],
    stripPrefixes: ['/**', '*', '//'],
  },

  paramConfig: {
    identifierNodeTypes: ['identifier'],
    typedParamNodeTypes: ['formal_parameter'],
    typeField: 'type',
    defaultParamNodeTypes: ['default_parameter'],
    filterNames: [],
  },

  importConfig: {
    moduleNodeTypes: ['qualified_name', 'identifier'],
    stripQuotes: false,
  },
};
