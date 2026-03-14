/**
 * F# language configuration
 */
import type { GenericLanguageConfig } from '@codegraph/plugin-generic';

export const fsharpConfig: Omit<GenericLanguageConfig, 'grammar'> = {
  id: 'fsharp',
  displayName: 'F#',
  extensions: ['.fs', '.fsi', '.fsx'],

  nodeTypes: {
    functions: ['function_or_value_defn', 'member_defn'],
    classes: ['type_definition', 'module_defn'],
    interfaces: ['type_definition'],
    variables: ['function_or_value_defn'],
    imports: ['open_directive', 'import_decl'],
    calls: ['application_expression'],
  },

  fields: {
    name: 'name',
    parameters: 'arguments',
    body: 'body',
    callee: 'function',
  },

  visibilityConfig: {
    strategy: 'all-public',
  },

  docstringConfig: {
    strategy: 'preceding-comment',
    commentNodeTypes: ['xml_doc', 'line_comment', 'block_comment'],
    stripPrefixes: ['///', '//'],
  },

  paramConfig: {
    identifierNodeTypes: ['identifier', 'long_identifier'],
    typedParamNodeTypes: ['typed'],
    typeField: 'type',
    defaultParamNodeTypes: [],
    filterNames: [],
  },

  importConfig: {
    moduleNodeTypes: ['long_identifier', 'identifier'],
    stripQuotes: false,
  },
};
