/**
 * Haskell language configuration
 */
import type { GenericLanguageConfig } from '@codegraph/plugin-generic';

export const haskellConfig: Omit<GenericLanguageConfig, 'grammar'> = {
  id: 'haskell',
  displayName: 'Haskell',
  extensions: ['.hs', '.lhs'],

  nodeTypes: {
    functions: ['function', 'signature'],
    classes: ['class', 'instance'],
    interfaces: ['class'],
    variables: ['bind'],
    imports: ['import'],
    types: ['type_alias', 'newtype', 'adt'],
    calls: ['function_application'],
  },

  fields: {
    name: 'name',
    parameters: 'patterns',
    body: 'match',
  },

  visibilityConfig: {
    strategy: 'all-public',
  },

  docstringConfig: {
    strategy: 'preceding-comment',
    commentNodeTypes: ['comment'],
    stripPrefixes: ['--', '{-', '-}'],
  },

  paramConfig: {
    identifierNodeTypes: ['variable', 'constructor'],
    typedParamNodeTypes: [],
    defaultParamNodeTypes: [],
    filterNames: [],
  },

  importConfig: {
    moduleNodeTypes: ['module'],
    stripQuotes: false,
  },
};
