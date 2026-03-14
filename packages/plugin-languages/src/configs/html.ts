/**
 * HTML language configuration
 * Minimal entity extraction
 */
import type { GenericLanguageConfig } from '@codegraph/plugin-generic';

export const htmlConfig: Omit<GenericLanguageConfig, 'grammar'> = {
  id: 'html',
  displayName: 'HTML',
  extensions: ['.html', '.htm'],

  nodeTypes: {
    functions: [],
    classes: [],
    variables: [],
    imports: ['script_element', 'style_element'], // External script/style references
  },

  fields: {
    name: 'tag_name',
  },

  visibilityConfig: {
    strategy: 'all-public',
  },

  docstringConfig: {
    strategy: 'none',
  },

  paramConfig: {
    identifierNodeTypes: [],
    typedParamNodeTypes: [],
    defaultParamNodeTypes: [],
    filterNames: [],
  },

  importConfig: {
    moduleNodeTypes: ['quoted_attribute_value'],
    stripQuotes: true,
  },
};
