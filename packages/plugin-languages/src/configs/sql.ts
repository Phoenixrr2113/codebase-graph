/**
 * SQL language configuration
 */
import type { GenericLanguageConfig } from '@codegraph/plugin-generic';

export const sqlConfig: Omit<GenericLanguageConfig, 'grammar'> = {
  id: 'sql',
  displayName: 'SQL',
  extensions: ['.sql'],

  nodeTypes: {
    functions: ['create_function_statement', 'create_procedure_statement'],
    classes: ['create_table_statement', 'create_view_statement'],
    interfaces: [],
    variables: ['set_statement', 'declare_statement'],
    imports: [],
    calls: ['function_call'],
  },

  fields: {
    name: 'name',
    parameters: 'parameters',
    body: 'body',
    callee: 'function_name',
  },

  visibilityConfig: {
    strategy: 'all-public',
  },

  docstringConfig: {
    strategy: 'preceding-comment',
    commentNodeTypes: ['comment', 'marginalia'],
    stripPrefixes: ['--', '/*'],
  },

  paramConfig: {
    identifierNodeTypes: ['identifier'],
    typedParamNodeTypes: ['parameter'],
    typeField: 'data_type',
    defaultParamNodeTypes: [],
    filterNames: [],
  },

  importConfig: {
    moduleNodeTypes: [],
    stripQuotes: false,
  },
};
