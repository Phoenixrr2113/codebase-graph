/**
 * Adversarial-review follow-up (wave B) on the batch-three Python/generic-
 * calls fix: one blocker plus two adjacent pre-existing bugs, all in the
 * same import/call-resolution machinery, reproduced live against fixtures
 * under scratchpad/review-batch3/wave-b/fixture-py* and now locked here.
 *
 *   BLOCKER: `from .mod import fn as f` then `f()` used to emit
 *            CallReference{calleeName: 'f', calleeFilePath: mod.py}, but the
 *            real node in mod.py is named `fn`. The graph's CREATE_CALLS_EDGE
 *            query (packages/graph/src/operations.ts) matches the callee by
 *            {name, filePath} parsed out of calleeId, so a callee id built
 *            from the local alias names a node that does not exist, and the
 *            edge silently drops. This test proves the callee id string now
 *            names the REAL declared function at the target file, not the
 *            call-site's local alias.
 *
 *   ADJACENT BUG 1: `import pkgns as p` set ImportEntity.namespaceAlias to
 *            the module's own name ('pkgns') instead of the local alias
 *            ('p'), so an attribute call `p.init_fn()` never matched
 *            anything in the namespace-import map and produced zero edges.
 *
 *   ADJACENT BUG 2: `from . import mod2` (importing a SUBMODULE by name, no
 *            module-name segment of its own) resolved the ImportEntity to
 *            the package's __init__.py instead of the mod2.py submodule
 *            actually being imported: a wrong edge, not a missing one.
 *            resolvePythonImport now tries the specifier name as a submodule
 *            file first, falling back to __init__.py only when no such
 *            submodule file exists (matching Python's own real import
 *            resolution order).
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs';
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

function parseAndExtract(filePath: string) {
  const content = readFileSync(filePath, 'utf-8');
  const syntaxTree = parseCode(content, 'python', '.py');
  const extracted = extractEntitiesForFile(syntaxTree.rootNode, filePath);
  const fileEntity = createFileEntityFromContent(filePath, content, new Date());
  return { rootNode: syntaxTree.rootNode, extracted, fileEntity };
}

function buildFile(filePath: string, projectRoot: string) {
  const parsed = parseAndExtract(filePath);
  return buildParsedFileEntities(
    parsed.fileEntity,
    parsed.extracted,
    parsed.rootNode,
    { deepAnalysis: true, includeExternals: false },
    projectRoot,
  );
}

function resolveFiles(filePaths: string[], projectRoot: string) {
  const built = filePaths.map((filePath) => buildFile(filePath, projectRoot));
  resolveProjectSymbolEdges(built, buildProjectSymbolCatalog(built));
  return built;
}

describe('BLOCKER: aliased cross-file import resolves to the DECLARED name, not the local alias', () => {
  let dir: string;

  beforeAll(() => {
    registerPlugins();
    dir = mkdtempSync(join(tmpdir(), 'py-review-b-alias-'));
    mkdirSync(join(dir, 'pkg'), { recursive: true });
    writeFileSync(join(dir, 'pkg', 'mod.py'), 'def fn():\n    return "fn value"\n');
    writeFileSync(
      join(dir, 'pkg', 'consumer_alias.py'),
      ['from .mod import fn as f', '', 'def caller_alias():', '    return f()', ''].join('\n'),
    );
  });

  afterAll(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('the CALLS edge callee id names the real Function node declared in mod.py (live-shape proof)', () => {
    // First, confirm what the target file ACTUALLY declares: this is not a
    // hardcoded assumption, it is mod.py's own extracted entity.
    const mod = parseAndExtract(join(dir, 'pkg', 'mod.py'));
    const realFn = mod.extracted.functions.find((f) => f.name === 'fn');
    expect(realFn).toBeDefined();
    expect(realFn!.name).toBe('fn'); // NOT 'f' -- the target has no idea it was aliased on import

    const [built, target] = resolveFiles([
      join(dir, 'pkg', 'consumer_alias.py'),
      join(dir, 'pkg', 'mod.py'),
    ], dir);

    const callerId = built?.functions.find((fn) => fn.name === 'caller_alias')?.id;
    const call = built?.callEdges.find((e) => e.callerId === callerId);
    expect(call).toBeDefined();
    const targetId = target?.functions.find((fn) => fn.name === realFn!.name)?.id;
    expect(call!.calleeId).toBe(targetId);
  });

  it('a plain (non-aliased) cross-file import still resolves to the same declared name (regression check)', () => {
    writeFileSync(
      join(dir, 'pkg', 'consumer_rel.py'),
      ['from .mod import fn', '', 'def caller_rel():', '    return fn()', ''].join('\n'),
    );
    const [built, target] = resolveFiles([
      join(dir, 'pkg', 'consumer_rel.py'),
      join(dir, 'pkg', 'mod.py'),
    ], dir);

    const callerId = built?.functions.find((fn) => fn.name === 'caller_rel')?.id;
    const call = built?.callEdges.find((e) => e.callerId === callerId);
    expect(call).toBeDefined();
    expect(call!.calleeId).toBe(target?.functions.find((fn) => fn.name === 'fn')?.id);
  });
});

describe('ADJACENT BUG 1: `import pkgns as p` resolves an attribute call through the local alias', () => {
  let dir: string;

  beforeAll(() => {
    registerPlugins();
    dir = mkdtempSync(join(tmpdir(), 'py-review-b-nsalias-'));
    mkdirSync(join(dir, 'pkgns'), { recursive: true });
    writeFileSync(join(dir, 'pkgns', '__init__.py'), 'def init_fn():\n    return "init"\n');
    writeFileSync(
      join(dir, 'consumer.py'),
      ['import pkgns as p', '', 'def caller():', '    return p.init_fn()', ''].join('\n'),
    );
  });

  afterAll(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('extractImports binds namespaceAlias to the local alias ("p"), not the module name ("pkgns")', () => {
    const consumer = parseAndExtract(join(dir, 'consumer.py'));
    const imp = consumer.extracted.imports.find((i) => i.source === 'pkgns');
    expect(imp).toBeDefined();
    expect(imp!.isNamespace).toBe(true);
    expect(imp!.namespaceAlias).toBe('p');
    // The source (used for file resolution) must still name the real module.
    expect(imp!.source).toBe('pkgns');
  });

  it('p.init_fn() resolves to a CALLS edge into pkgns/__init__.py (was zero edges before this fix)', () => {
    const [built, target] = resolveFiles([
      join(dir, 'consumer.py'),
      join(dir, 'pkgns', '__init__.py'),
    ], dir);

    const callerId = built?.functions.find((fn) => fn.name === 'caller')?.id;
    const call = built?.callEdges.find((e) => e.callerId === callerId);
    expect(call).toBeDefined();
    expect(call!.calleeId).toBe(target?.functions.find((fn) => fn.name === 'init_fn')?.id);
  });
});

describe('ADJACENT BUG 2: `from . import <name>` prefers an existing submodule file over the package __init__.py', () => {
  let dir: string;

  beforeAll(() => {
    registerPlugins();
    dir = mkdtempSync(join(tmpdir(), 'py-review-b-frompkg-'));
  });

  afterAll(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('outcome 1: the name IS a submodule file (mod2.py exists) -- resolves to mod2.py, not __init__.py', () => {
    const pkgDir = join(dir, 'fromdotmod');
    mkdirSync(pkgDir, { recursive: true });
    writeFileSync(join(pkgDir, '__init__.py'), '');
    writeFileSync(join(pkgDir, 'mod2.py'), 'def something():\n    return "mod2 value"\n');
    writeFileSync(
      join(pkgDir, 'user.py'),
      ['from . import mod2', '', 'def caller_dotmod():', '    return mod2.something()', ''].join('\n'),
    );

    const user = parseAndExtract(join(pkgDir, 'user.py'));
    const built = buildParsedFileEntities(
      user.fileEntity,
      user.extracted,
      user.rootNode,
      { deepAnalysis: true, includeExternals: false },
      dir,
    );

    const importEdge = built.importsEdges.find((e) => e.fromFilePath === join(pkgDir, 'user.py'));
    expect(importEdge).toBeDefined();
    expect(importEdge!.toFilePath).toBe(join(pkgDir, 'mod2.py'));
    expect(importEdge!.toFilePath).not.toBe(join(pkgDir, '__init__.py'));
  });

  it('outcome 2: the name is NOT a submodule file -- falls back to the package __init__.py', () => {
    const pkgDir = join(dir, 'onlyinit');
    mkdirSync(pkgDir, { recursive: true });
    writeFileSync(join(pkgDir, '__init__.py'), 'def helper():\n    return "helper value"\n');
    // Note: no onlyinit/helper.py submodule file exists on disk.
    writeFileSync(
      join(pkgDir, 'user.py'),
      ['from . import helper', '', 'def caller():', '    return helper', ''].join('\n'),
    );

    const user = parseAndExtract(join(pkgDir, 'user.py'));
    const built = buildParsedFileEntities(
      user.fileEntity,
      user.extracted,
      user.rootNode,
      { deepAnalysis: true, includeExternals: false },
      dir,
    );

    const importEdge = built.importsEdges.find((e) => e.fromFilePath === join(pkgDir, 'user.py'));
    expect(importEdge).toBeDefined();
    expect(importEdge!.toFilePath).toBe(join(pkgDir, '__init__.py'));
  });
});
