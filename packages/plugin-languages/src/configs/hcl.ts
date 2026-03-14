/**
 * HCL/Terraform language configuration
 */
import type { GenericLanguageConfig } from '@codegraph/plugin-generic';

export const hclConfig: Omit<GenericLanguageConfig, 'grammar'> = {
  id: 'hcl',
  displayName: 'HCL (Terraform)',
  extensions: ['.tf', '.tfvars', '.hcl'],

  nodeTypes: {
    functions: [],
    classes: ['block'],
    interfaces: [],
    variables: ['attribute'],
    imports: [],
    calls: ['function_call'],
  },

  fields: {
    name: 'identifier',
    body: 'body',
    callee: 'function',
  },

  visibilityConfig: {
    strategy: 'all-public',
  },

  docstringConfig: {
    strategy: 'preceding-comment',
    commentNodeTypes: ['comment'],
    stripPrefixes: ['#', '//'],
  },

  paramConfig: {
    identifierNodeTypes: ['identifier'],
    typedParamNodeTypes: [],
    defaultParamNodeTypes: [],
    filterNames: [],
  },

  importConfig: {
    moduleNodeTypes: [],
    stripQuotes: false,
  },
};
