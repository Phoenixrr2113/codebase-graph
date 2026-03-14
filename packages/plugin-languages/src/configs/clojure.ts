/**
 * Clojure language configuration
 */
import type { GenericLanguageConfig } from '@codegraph/plugin-generic';

export const clojureConfig: Omit<GenericLanguageConfig, 'grammar'> = {
  id: 'clojure',
  displayName: 'Clojure',
  extensions: ['.clj', '.cljs', '.cljc', '.edn'],

  nodeTypes: {
    functions: ['defn', 'defn-'],
    classes: ['deftype', 'defrecord', 'defprotocol'],
    interfaces: ['defprotocol'],
    variables: ['def'],
    imports: ['ns_require', 'ns_import', 'require'],
    calls: ['list'],
  },

  fields: {
    name: 'name',
    parameters: 'value',
    body: 'value',
    callee: 'name',
  },

  visibilityConfig: {
    strategy: 'all-public',
  },

  docstringConfig: {
    strategy: 'none',
  },

  paramConfig: {
    identifierNodeTypes: ['symbol'],
    typedParamNodeTypes: [],
    defaultParamNodeTypes: [],
    filterNames: [],
  },

  importConfig: {
    moduleNodeTypes: ['symbol', 'keyword'],
    stripQuotes: false,
  },
};
