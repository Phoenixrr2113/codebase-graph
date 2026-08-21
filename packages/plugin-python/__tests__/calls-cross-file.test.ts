/**
 * Cross-file call resolution for Python (batch-three fix, bugs 2 and 3).
 *
 * Before this fix, plugin-python delegated extractCalls to plugin-generic's
 * genericExtractCalls, which only ever matched a callee name against the
 * CURRENT file's own function names (localFunctionNames). A call to a
 * function imported from another module was silently dropped: no edge was
 * ever produced, not even a same-file (wrong) one.
 *
 * These tests exercise pythonPlugin's real extractCalls (which is
 * genericExtractCalls under the hood, since Python does not override
 * extractCalls) against real tree-sitter-python ASTs, passing a
 * CallExtractionContext whose imports carry a resolvedPath, the way
 * pipeline.ts now backfills it after resolvePythonImport succeeds.
 */

import { describe, it, expect, beforeAll } from 'vitest';
import Parser from 'tree-sitter';
import Python from 'tree-sitter-python';
import type { ImportEntity } from '@codegraph/types';
import { extractCalls } from '../src';

const TEST_FILE = '/proj/pkg/caller.py';
const MOD_FILE = '/proj/pkg/mod.py';
const UTIL_FILE = '/proj/util.py';

let parser: Parser;

function parseCode(code: string): Parser.SyntaxNode {
  const tree = parser.parse(code);
  return tree.rootNode;
}

describe('Python extractCalls: cross-file resolution via import context', () => {
  beforeAll(() => {
    parser = new Parser();
    parser.setLanguage(Python as any);
  });

  it('(c) resolves a call to a name imported via `from .mod import fn`, when the import carries a resolvedPath', () => {
    const code = `
from .mod import fn

def caller():
    return fn()
    `;
    const rootNode = parseCode(code);

    const modImport: ImportEntity = {
      id: 'imp-1',
      source: '.mod',
      filePath: TEST_FILE,
      isDefault: false,
      isNamespace: false,
      specifiers: [{ name: 'fn' }],
      resolvedPath: MOD_FILE,
    };

    const calls = extractCalls(rootNode as any, TEST_FILE, { imports: [modImport] });

    expect(calls).toHaveLength(1);
    expect(calls[0].callerName).toBe('caller');
    expect(calls[0].calleeName).toBe('fn');
    expect(calls[0].calleeFilePath).toBe(MOD_FILE);
  });

  it('(blocker) resolves a call through an aliased import to the DECLARED name at the target, not the local alias', () => {
    // `from .mod import fn as f` binds `f` at the call site, but the real
    // Function node in mod.py is named `fn`. Emitting `f` as calleeName would
    // build a callee id naming a node that does not exist at MOD_FILE, and
    // the CALLS edge would silently drop at graph-write time.
    const code = `
from .mod import fn as f

def caller():
    return f()
    `;
    const rootNode = parseCode(code);

    const modImport: ImportEntity = {
      id: 'imp-alias',
      source: '.mod',
      filePath: TEST_FILE,
      isDefault: false,
      isNamespace: false,
      specifiers: [{ name: 'fn', alias: 'f' }],
      resolvedPath: MOD_FILE,
    };

    const calls = extractCalls(rootNode as any, TEST_FILE, { imports: [modImport] });

    expect(calls).toHaveLength(1);
    expect(calls[0].callerName).toBe('caller');
    expect(calls[0].calleeName).toBe('fn');
    expect(calls[0].calleeFilePath).toBe(MOD_FILE);
  });

  it('(c) drops the call (no edge, no crash) when the import has no resolvedPath (unresolved/external)', () => {
    const code = `
from .missing import fn

def caller():
    return fn()
    `;
    const rootNode = parseCode(code);

    const unresolvedImport: ImportEntity = {
      id: 'imp-2',
      source: '.missing',
      filePath: TEST_FILE,
      isDefault: false,
      isNamespace: false,
      specifiers: [{ name: 'fn' }],
      // no resolvedPath: the module could not be resolved to a real file
    };

    const calls = extractCalls(rootNode as any, TEST_FILE, { imports: [unresolvedImport] });

    expect(calls).toHaveLength(0);
  });

  it('regression: without a context argument at all, cross-file calls still produce nothing (old call-site shape keeps working)', () => {
    const code = `
from .mod import fn

def caller():
    return fn()
    `;
    const rootNode = parseCode(code);

    const calls = extractCalls(rootNode as any, TEST_FILE);

    expect(calls).toHaveLength(0);
  });

  it('same-file calls still resolve locally and carry no calleeFilePath, even when a context is supplied', () => {
    const code = `
from .mod import fn

def helper():
    return 1

def caller():
    helper()
    return fn()
    `;
    const rootNode = parseCode(code);

    const modImport: ImportEntity = {
      id: 'imp-3',
      source: '.mod',
      filePath: TEST_FILE,
      isDefault: false,
      isNamespace: false,
      specifiers: [{ name: 'fn' }],
      resolvedPath: MOD_FILE,
    };

    const calls = extractCalls(rootNode as any, TEST_FILE, { imports: [modImport] });

    expect(calls).toHaveLength(2);
    const localCall = calls.find((c) => c.calleeName === 'helper')!;
    expect(localCall).toBeDefined();
    expect(localCall.calleeFilePath).toBeUndefined();

    const crossFileCall = calls.find((c) => c.calleeName === 'fn')!;
    expect(crossFileCall).toBeDefined();
    expect(crossFileCall.calleeFilePath).toBe(MOD_FILE);
  });

  it('(d) resolves a module-qualified attribute call `module.fn()` when `import module` is resolved', () => {
    const code = `
import util

def caller():
    return util.helper()
    `;
    const rootNode = parseCode(code);

    const utilImport: ImportEntity = {
      id: 'imp-4',
      source: 'util',
      filePath: TEST_FILE,
      isDefault: false,
      isNamespace: true,
      specifiers: [],
      namespaceAlias: 'util',
      resolvedPath: UTIL_FILE,
    };

    const calls = extractCalls(rootNode as any, TEST_FILE, { imports: [utilImport] });

    expect(calls).toHaveLength(1);
    expect(calls[0].callerName).toBe('caller');
    expect(calls[0].calleeName).toBe('helper');
    expect(calls[0].calleeFilePath).toBe(UTIL_FILE);
  });

  it('(d) drops the attribute call when the module import has no resolvedPath', () => {
    const code = `
import util

def caller():
    return util.helper()
    `;
    const rootNode = parseCode(code);

    const utilImport: ImportEntity = {
      id: 'imp-5',
      source: 'util',
      filePath: TEST_FILE,
      isDefault: false,
      isNamespace: true,
      specifiers: [],
      namespaceAlias: 'util',
      // no resolvedPath
    };

    const calls = extractCalls(rootNode as any, TEST_FILE, { imports: [utilImport] });

    expect(calls).toHaveLength(0);
  });
});
