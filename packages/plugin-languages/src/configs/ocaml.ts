/**
 * OCaml language configuration
 */
import type { GenericLanguageConfig } from '@codegraph/plugin-generic';

export const ocamlConfig: Omit<GenericLanguageConfig, 'grammar'> = {
  id: 'ocaml',
  displayName: 'OCaml',
  extensions: ['.ml', '.mli'],

  nodeTypes: {
    functions: ['let_binding', 'value_definition'],
    classes: ['class_definition', 'module_definition', 'type_definition'],
    interfaces: ['module_type_definition', 'class_type_definition'],
    variables: ['let_binding'],
    imports: ['open_statement'],
    calls: ['application'],
  },

  fields: {
    name: 'name',
    parameters: 'parameter',
    body: 'body',
    callee: 'function',
  },

  visibilityConfig: {
    strategy: 'all-public',
  },

  docstringConfig: {
    strategy: 'preceding-comment',
    commentNodeTypes: ['comment'],
    stripPrefixes: ['(*'],
  },

  paramConfig: {
    identifierNodeTypes: ['value_name', 'value_pattern'],
    typedParamNodeTypes: ['typed'],
    typeField: 'type',
    defaultParamNodeTypes: [],
    filterNames: [],
  },

  importConfig: {
    moduleNodeTypes: ['module_path', 'module_name'],
    stripQuotes: false,
  },
};
