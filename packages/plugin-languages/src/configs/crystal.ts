/**
 * Crystal language configuration
 */
import type { GenericLanguageConfig } from '@codegraph/plugin-generic';

export const crystalConfig: Omit<GenericLanguageConfig, 'grammar'> = {
  id: 'crystal',
  displayName: 'Crystal',
  extensions: ['.cr'],

  nodeTypes: {
    functions: ['method_def', 'fun_def'],
    classes: ['class_def', 'module_def', 'struct_def', 'enum_def'],
    interfaces: ['abstract_def'],
    variables: ['assign'],
    imports: ['require'],
    calls: ['call'],
  },

  fields: {
    name: 'name',
    parameters: 'params',
    body: 'body',
    superclass: 'superclass',
    callee: 'method',
  },

  visibilityConfig: {
    strategy: 'all-public',
  },

  docstringConfig: {
    strategy: 'preceding-comment',
    commentNodeTypes: ['comment'],
    stripPrefixes: ['#'],
  },

  paramConfig: {
    identifierNodeTypes: ['identifier'],
    typedParamNodeTypes: ['typed_param'],
    typeField: 'type',
    defaultParamNodeTypes: ['default_param'],
    filterNames: [],
  },

  importConfig: {
    moduleNodeTypes: ['string', 'string_content'],
    stripQuotes: true,
  },
};
