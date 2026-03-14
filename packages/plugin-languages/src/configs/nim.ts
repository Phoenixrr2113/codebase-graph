/**
 * Nim language configuration
 */
import type { GenericLanguageConfig } from '@codegraph/plugin-generic';

export const nimConfig: Omit<GenericLanguageConfig, 'grammar'> = {
  id: 'nim',
  displayName: 'Nim',
  extensions: ['.nim', '.nims', '.nimble'],

  nodeTypes: {
    functions: ['proc_declaration', 'func_declaration', 'method_declaration', 'template_declaration', 'macro_declaration'],
    classes: ['type_section', 'object_declaration'],
    interfaces: [],
    variables: ['var_section', 'let_section', 'const_section'],
    imports: ['import_statement', 'from_statement'],
    calls: ['call', 'command'],
  },

  fields: {
    name: 'name',
    parameters: 'parameters',
    body: 'body',
    callee: 'function',
  },

  visibilityConfig: {
    strategy: 'modifier',
    exportedModifiers: ['*'],
  },

  docstringConfig: {
    strategy: 'preceding-comment',
    commentNodeTypes: ['comment', 'documentation_comment'],
    stripPrefixes: ['##', '#'],
  },

  paramConfig: {
    identifierNodeTypes: ['identifier'],
    typedParamNodeTypes: ['identifier_declaration'],
    typeField: 'type',
    defaultParamNodeTypes: [],
    filterNames: [],
  },

  importConfig: {
    moduleNodeTypes: ['identifier', 'dot_expression'],
    stripQuotes: false,
  },
};
