/**
 * genericExtractCalls: import-context-aware cross-file call resolution
 * (batch-three fix, bug 2).
 *
 * Before this fix, the generic factory's call extractor accepted no context
 * parameter at all and only ever matched a callee name against the CURRENT
 * file's own function names. Every config-driven language built on
 * createLanguagePlugin() (Python included, plus every tier-2 language:
 * Ruby, Kotlin, Swift, ...) silently dropped every cross-file call, no
 * matter how the language's own extractImports resolved paths.
 *
 * These tests exercise createLanguagePlugin() and genericExtractCalls
 * directly, decoupled from any specific shipped language plugin, using real
 * tree-sitter parsing (borrowing the Python grammar as a stand-in syntax,
 * since the generic factory itself is language-agnostic and only cares
 * about the configured node/field names, which are set up here to match).
 *
 * The tier-2 regression case (one config language still extracting same-file
 * calls unchanged with no context) is covered directly here: calling
 * extractCalls with no context argument at all must behave exactly as it did
 * before this fix.
 */

import { describe, it, expect, beforeAll } from 'vitest';
import Parser from 'tree-sitter';
import Python from 'tree-sitter-python';
import type { ImportEntity } from '@codegraph/types';
import { createLanguagePlugin, type GenericLanguageConfig } from '../src';

let parser: Parser;

function parseCode(code: string): Parser.SyntaxNode {
  const tree = parser.parse(code);
  return tree.rootNode;
}

const testConfig: GenericLanguageConfig = {
  id: 'testlang',
  displayName: 'TestLang (synthetic, for generic-factory unit tests)',
  extensions: ['.tl'],
  grammar: Python,
  nodeTypes: {
    functions: ['function_definition'],
    classes: ['class_definition'],
    imports: ['import_statement', 'import_from_statement'],
    calls: ['call'],
  },
};

const FILE = '/proj/caller.tl';
const MOD_FILE = '/proj/mod.tl';
const UTIL_FILE = '/proj/util.tl';

describe('createLanguagePlugin: extractCalls context handling', () => {
  beforeAll(() => {
    parser = new Parser();
    parser.setLanguage(Python as any);
  });

  it('same-file calls resolve as before with no context at all (tier-2 regression: unchanged behavior)', () => {
    const plugin = createLanguagePlugin(testConfig);
    const code = `
def helper():
    return 1

def caller():
    return helper()
    `;
    const root = parseCode(code);

    const calls = plugin.extractors.extractCalls!(root as any, FILE);

    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({ callerName: 'caller', calleeName: 'helper', filePath: FILE });
    expect(calls[0].calleeFilePath).toBeUndefined();
  });

  it('a call to a name that is neither local nor a known import is still dropped (tier-2 regression: no context)', () => {
    const plugin = createLanguagePlugin(testConfig);
    const code = `
def caller():
    return unknown_external()
    `;
    const root = parseCode(code);

    const calls = plugin.extractors.extractCalls!(root as any, FILE);

    expect(calls).toHaveLength(0);
  });

  it('resolves a cross-file call through context.imports when the imported specifier carries a resolvedPath', () => {
    const plugin = createLanguagePlugin(testConfig);
    const code = `
from .mod import fn

def caller():
    return fn()
    `;
    const root = parseCode(code);

    const modImport: ImportEntity = {
      id: 'imp-1',
      source: '.mod',
      filePath: FILE,
      isDefault: false,
      isNamespace: false,
      specifiers: [{ name: 'fn' }],
      resolvedPath: MOD_FILE,
    };

    const calls = plugin.extractors.extractCalls!(root as any, FILE, { imports: [modImport] });

    expect(calls).toHaveLength(1);
    expect(calls[0].calleeName).toBe('fn');
    expect(calls[0].calleeFilePath).toBe(MOD_FILE);
  });

  it('an aliased specifier is looked up by its local alias at the call site, but resolves to the DECLARED name at the target file (not the alias)', () => {
    // The call site uses the local alias (`aliasedFn`), since that is the
    // identifier actually written in the source. But the real Function node
    // at MOD_FILE is named `fn` (the name it is declared under there): a
    // consumer's local rename has no effect on what the target file calls
    // itself. Emitting `aliasedFn` as calleeName here would build a callee id
    // that names a Function node which does not exist at MOD_FILE, silently
    // dropping the edge downstream (the exact blocker this test locks).
    const plugin = createLanguagePlugin(testConfig);
    const code = `
from .mod import fn as aliasedFn

def caller():
    return aliasedFn()
    `;
    const root = parseCode(code);

    const modImport: ImportEntity = {
      id: 'imp-2',
      source: '.mod',
      filePath: FILE,
      isDefault: false,
      isNamespace: false,
      specifiers: [{ name: 'fn', alias: 'aliasedFn' }],
      resolvedPath: MOD_FILE,
    };

    const calls = plugin.extractors.extractCalls!(root as any, FILE, { imports: [modImport] });

    expect(calls).toHaveLength(1);
    expect(calls[0].calleeName).toBe('fn');
    expect(calls[0].calleeFilePath).toBe(MOD_FILE);
  });

  it('does not emit an edge for an imported name whose import has no resolvedPath (unresolvable stays dropped)', () => {
    const plugin = createLanguagePlugin(testConfig);
    const code = `
from .mod import fn

def caller():
    return fn()
    `;
    const root = parseCode(code);

    const unresolvedImport: ImportEntity = {
      id: 'imp-3',
      source: '.mod',
      filePath: FILE,
      isDefault: false,
      isNamespace: false,
      specifiers: [{ name: 'fn' }],
      // no resolvedPath
    };

    const calls = plugin.extractors.extractCalls!(root as any, FILE, { imports: [unresolvedImport] });

    expect(calls).toHaveLength(0);
  });

  it('a local function name still wins over a same-named import (same-file gate stays first)', () => {
    const plugin = createLanguagePlugin(testConfig);
    const code = `
from .mod import fn

def fn():
    return 0

def caller():
    return fn()
    `;
    const root = parseCode(code);

    const modImport: ImportEntity = {
      id: 'imp-4',
      source: '.mod',
      filePath: FILE,
      isDefault: false,
      isNamespace: false,
      specifiers: [{ name: 'fn' }],
      resolvedPath: MOD_FILE,
    };

    const calls = plugin.extractors.extractCalls!(root as any, FILE, { imports: [modImport] });

    expect(calls).toHaveLength(1);
    expect(calls[0].calleeName).toBe('fn');
    expect(calls[0].calleeFilePath).toBeUndefined(); // same-file, not MOD_FILE
  });

  it('resolves a module-qualified attribute call through a namespace import', () => {
    const plugin = createLanguagePlugin(testConfig);
    const code = `
import util

def caller():
    return util.helper()
    `;
    const root = parseCode(code);

    const utilImport: ImportEntity = {
      id: 'imp-5',
      source: 'util',
      filePath: FILE,
      isDefault: false,
      isNamespace: true,
      specifiers: [],
      namespaceAlias: 'util',
      resolvedPath: UTIL_FILE,
    };

    const calls = plugin.extractors.extractCalls!(root as any, FILE, { imports: [utilImport] });

    expect(calls).toHaveLength(1);
    expect(calls[0].calleeName).toBe('helper');
    expect(calls[0].calleeFilePath).toBe(UTIL_FILE);
  });

  it('builtins are skipped regardless of whether a context is supplied', () => {
    const config: GenericLanguageConfig = {
      ...testConfig,
      overrides: { builtinFunctions: new Set(['print']) },
    };
    const plugin = createLanguagePlugin(config);
    const code = `
from .mod import print

def caller():
    return print()
    `;
    const root = parseCode(code);

    const modImport: ImportEntity = {
      id: 'imp-6',
      source: '.mod',
      filePath: FILE,
      isDefault: false,
      isNamespace: false,
      specifiers: [{ name: 'print' }],
      resolvedPath: MOD_FILE,
    };

    const calls = plugin.extractors.extractCalls!(root as any, FILE, { imports: [modImport] });

    expect(calls).toHaveLength(0);
  });
});
