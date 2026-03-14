/**
 * Dockerfile language configuration
 */
import type { GenericLanguageConfig } from '@codegraph/plugin-generic';

export const dockerfileConfig: Omit<GenericLanguageConfig, 'grammar'> = {
  id: 'dockerfile',
  displayName: 'Dockerfile',
  extensions: ['.dockerfile'],

  nodeTypes: {
    functions: [],
    classes: ['from_instruction'],
    interfaces: [],
    variables: ['env_instruction', 'arg_instruction', 'label_instruction'],
    imports: ['from_instruction'],
    calls: ['run_instruction'],
  },

  fields: {
    name: 'image',
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
    identifierNodeTypes: [],
    typedParamNodeTypes: [],
    defaultParamNodeTypes: [],
    filterNames: [],
  },

  importConfig: {
    moduleNodeTypes: ['image_spec'],
    stripQuotes: false,
  },
};
