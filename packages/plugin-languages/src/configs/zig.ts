/**
 * Zig language configuration
 */
import type { GenericLanguageConfig } from '@codegraph/plugin-generic';

export const zigConfig: Omit<GenericLanguageConfig, 'grammar'> = {
  id: 'zig',
  displayName: 'Zig',
  extensions: ['.zig'],

  nodeTypes: {
    functions: ['fn_proto', 'fn_decl'],
    classes: ['container_decl'],
    interfaces: [],
    variables: ['var_decl', 'const_decl'],
    imports: [],  // Zig uses @import() builtin, handled as call
    calls: ['call_expr', 'builtin_call_expr'],
  },

  fields: {
    name: 'name',
    parameters: 'parameters',
    body: 'body',
    callee: 'function',
  },

  visibilityConfig: {
    strategy: 'modifier',
    exportedModifiers: ['pub'],
  },

  docstringConfig: {
    strategy: 'preceding-comment',
    commentNodeTypes: ['doc_comment', 'line_comment'],
    stripPrefixes: ['///', '//'],
  },

  paramConfig: {
    identifierNodeTypes: ['identifier'],
    typedParamNodeTypes: ['param_decl'],
    typeField: 'type',
    defaultParamNodeTypes: [],
    filterNames: [],
  },

  importConfig: {
    moduleNodeTypes: ['string_literal'],
    stripQuotes: true,
  },
};
