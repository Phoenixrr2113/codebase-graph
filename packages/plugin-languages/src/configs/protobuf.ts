/**
 * Protocol Buffers language configuration
 */
import type { GenericLanguageConfig } from '@codegraph/plugin-generic';

export const protobufConfig: Omit<GenericLanguageConfig, 'grammar'> = {
  id: 'protobuf',
  displayName: 'Protocol Buffers',
  extensions: ['.proto'],

  nodeTypes: {
    functions: ['rpc'],
    classes: ['message', 'service', 'enum'],
    interfaces: [],
    variables: ['field'],
    imports: ['import'],
    calls: [],
  },

  fields: {
    name: 'name',
    body: 'body',
  },

  visibilityConfig: {
    strategy: 'all-public',
  },

  docstringConfig: {
    strategy: 'preceding-comment',
    commentNodeTypes: ['comment'],
    stripPrefixes: ['//'],
  },

  paramConfig: {
    identifierNodeTypes: ['identifier'],
    typedParamNodeTypes: [],
    defaultParamNodeTypes: [],
    filterNames: [],
  },

  importConfig: {
    moduleNodeTypes: ['string'],
    stripQuotes: true,
  },
};
