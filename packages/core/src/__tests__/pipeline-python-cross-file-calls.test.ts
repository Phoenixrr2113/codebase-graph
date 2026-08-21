/**
 * End-to-end pipeline coverage for the batch-three Python/generic-calls fix
 * set (three bugs, verified together here through buildParsedFileEntities):
 *
 *   Bug 1: resolvePythonImport used to fabricate a path for any candidate
 *          that merely looked project-relative, with no existsSync check.
 *          A phantom :File:External node got MERGEd into the graph for an
 *          import that pointed at nothing.
 *   Bug 2: plugin-python's extractCalls (genericExtractCalls under the
 *          hood) only ever matched a callee name against the CURRENT file's
 *          own functions. A call to a function imported from another module
 *          produced no edge at all.
 *   Bug 3: buildCallEdgesFromRefs built every callee id off the CALLER's
 *          filePath unconditionally, so even a plugin that correctly
 *          resolved a cross-file callee had that resolution thrown away at
 *          the pipeline layer.
 *
 * This test proves the fix at the layer real indexing goes through:
 * buildParsedFileEntities with real tree-sitter-python parsing and real
 * files on disk (so resolvePythonImport's existsSync checks have something
 * genuine to check against).
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  registerPlugins,
  parseCode,
  extractEntitiesForFile,
  createFileEntityFromContent,
  buildParsedFileEntities,
} from '../pipeline';
import {
  buildProjectSymbolCatalog,
  resolveProjectSymbolEdges,
} from '../pipeline/pipeline';

describe('buildParsedFileEntities: Python cross-file call resolution (end-to-end)', () => {
  let dir: string;

  beforeAll(() => {
    registerPlugins();
    dir = mkdtempSync(join(tmpdir(), 'py-cross-file-calls-'));
    writeFileSync(join(dir, 'mod.py'), 'def fn():\n    return 1\n');
    writeFileSync(
      join(dir, 'caller.py'),
      ['from .mod import fn', '', 'def caller():', '    return fn()', ''].join('\n'),
    );
    writeFileSync(
      join(dir, 'phantom_caller.py'),
      ['from .does_not_exist import ghost', '', 'def caller():', '    return ghost()', ''].join('\n'),
    );
  });

  afterAll(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  function parseAndExtract(filePath: string) {
    const content = readFileSync(filePath, 'utf-8');
    const syntaxTree = parseCode(content, 'python', '.py');
    const extracted = extractEntitiesForFile(syntaxTree.rootNode, filePath);
    const fileEntity = createFileEntityFromContent(filePath, content, new Date());
    return { rootNode: syntaxTree.rootNode, extracted, fileEntity };
  }

  function build(filePath: string) {
    const parsed = parseAndExtract(filePath);
    return buildParsedFileEntities(
      parsed.fileEntity,
      parsed.extracted,
      parsed.rootNode,
      { deepAnalysis: true, includeExternals: false },
      dir,
    );
  }

  it('(e) resolves the IMPORTS edge to the real file on disk (bug 1: no phantom edge for an existing module)', () => {
    const caller = parseAndExtract(join(dir, 'caller.py'));

    const built = buildParsedFileEntities(
      caller.fileEntity,
      caller.extracted,
      caller.rootNode,
      { deepAnalysis: true, includeExternals: false },
      dir,
    );

    const importEdge = built.importsEdges.find((e) => e.fromFilePath === join(dir, 'caller.py'));
    expect(importEdge).toBeDefined();
    expect(importEdge!.toFilePath).toBe(join(dir, 'mod.py'));
  });

  it('(e) emits NO import edge for a module that does not exist on disk (bug 1: phantom edge eliminated)', () => {
    const phantomCaller = parseAndExtract(join(dir, 'phantom_caller.py'));

    const built = buildParsedFileEntities(
      phantomCaller.fileEntity,
      phantomCaller.extracted,
      phantomCaller.rootNode,
      { deepAnalysis: true, includeExternals: false },
      dir,
    );

    // Before the fix, this would have fabricated an edge to
    // <dir>/does_not_exist.py, a file that was never created.
    expect(built.importsEdges).toHaveLength(0);
  });

  it('(e) buildCallEdgesFromRefs keys the CALLS edge on the resolved callee file, not the caller file (bugs 2 + 3 together)', () => {
    const built = build(join(dir, 'caller.py'));
    const target = build(join(dir, 'mod.py'));
    resolveProjectSymbolEdges([built, target], buildProjectSymbolCatalog([built, target]));

    const callerId = built.functions.find((fn) => fn.name === 'caller')?.id;
    const targetId = target.functions.find((fn) => fn.name === 'fn')?.id;
    const call = built.callEdges.find((e) => e.callerId === callerId);
    expect(call).toBeDefined();
    // Before the fix: this edge either didn't exist (bug 2 dropped it
    // entirely) or, if it had, would have pointed at
    // Function:<dir>/caller.py:fn (bug 3), a Function node that doesn't
    // exist there since fn is defined in mod.py.
    expect(call!.calleeId).toBe(targetId);
  });

  it('(e) a call to an unresolvable cross-file name produces no edge at all, not a wrong same-file one', () => {
    const built = build(join(dir, 'phantom_caller.py'));
    resolveProjectSymbolEdges([built], buildProjectSymbolCatalog([built]));

    const callerId = built.functions.find((fn) => fn.name === 'caller')?.id;
    const call = built.callEdges.find((e) => e.callerId === callerId);
    expect(call).toBeUndefined();
  });
});
