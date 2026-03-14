/**
 * Verilog/SystemVerilog language configuration
 */
import type { GenericLanguageConfig } from '@codegraph/plugin-generic';

export const verilogConfig: Omit<GenericLanguageConfig, 'grammar'> = {
  id: 'verilog',
  displayName: 'Verilog',
  extensions: ['.v', '.sv', '.svh'],

  nodeTypes: {
    functions: ['function_declaration', 'task_declaration'],
    classes: ['module_declaration', 'class_declaration'],
    interfaces: ['interface_declaration'],
    variables: ['net_declaration', 'reg_declaration', 'parameter_declaration'],
    imports: ['package_import_declaration'],
    calls: ['module_instantiation', 'function_subroutine_call'],
  },

  fields: {
    name: 'name',
    parameters: 'port_list',
    body: 'body',
    callee: 'identifier',
  },

  visibilityConfig: {
    strategy: 'all-public',
  },

  docstringConfig: {
    strategy: 'preceding-comment',
    commentNodeTypes: ['comment'],
    stripPrefixes: ['//', '/*'],
  },

  paramConfig: {
    identifierNodeTypes: ['identifier'],
    typedParamNodeTypes: [],
    defaultParamNodeTypes: [],
    filterNames: [],
  },

  importConfig: {
    moduleNodeTypes: ['package_scope'],
    stripQuotes: false,
  },
};
