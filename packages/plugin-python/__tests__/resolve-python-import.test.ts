/**
 * resolvePythonImport: existence-checked resolution (batch-three fix).
 *
 * Before this fix, resolvePythonImport built candidate paths from the dotted
 * module name and returned the FIRST candidate that merely looked like a
 * project-relative path (started with projectRoot, didn't cross into
 * site-packages) with NO check that the file actually exists. Downstream,
 * the pipeline pushed that fabricated path into importsEdges unconditionally,
 * and the graph MERGEd a phantom :File:External node at a path nobody wrote.
 *
 * These tests use real temp directories on disk so existsSync has something
 * real to check against, per the existing plugin test convention of using
 * real inputs rather than mocking the filesystem.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { resolvePythonImport } from '../src';

describe('resolvePythonImport', () => {
  let projectRoot: string;

  beforeEach(() => {
    projectRoot = mkdtempSync(join(tmpdir(), 'codegraph-py-import-'));
  });

  afterEach(() => {
    rmSync(projectRoot, { recursive: true, force: true });
  });

  describe('relative imports', () => {
    it('(a) resolves `from .mod import fn` to an existing sibling module file', () => {
      mkdirSync(join(projectRoot, 'pkg'), { recursive: true });
      writeFileSync(join(projectRoot, 'pkg', 'mod.py'), 'def fn():\n    pass\n');
      const importingFilePath = join(projectRoot, 'pkg', 'caller.py');
      writeFileSync(importingFilePath, 'from .mod import fn\n');

      const resolved = resolvePythonImport('.mod', importingFilePath, projectRoot);

      expect(resolved).toBe(join(projectRoot, 'pkg', 'mod.py'));
    });

    it('(a) returns undefined (no phantom edge) when the relatively-imported module does not exist on disk', () => {
      mkdirSync(join(projectRoot, 'pkg'), { recursive: true });
      const importingFilePath = join(projectRoot, 'pkg', 'caller.py');
      writeFileSync(importingFilePath, 'from .missing_mod import fn\n');
      // Note: pkg/missing_mod.py is deliberately never created.

      const resolved = resolvePythonImport('.missing_mod', importingFilePath, projectRoot);

      expect(resolved).toBeUndefined();
    });

    it('(b) resolves a relative package import to its __init__.py', () => {
      mkdirSync(join(projectRoot, 'pkg', 'subpkg'), { recursive: true });
      writeFileSync(join(projectRoot, 'pkg', 'subpkg', '__init__.py'), '');
      const importingFilePath = join(projectRoot, 'pkg', 'caller.py');
      writeFileSync(importingFilePath, 'from .subpkg import helper\n');

      const resolved = resolvePythonImport('.subpkg', importingFilePath, projectRoot);

      expect(resolved).toBe(join(projectRoot, 'pkg', 'subpkg', '__init__.py'));
    });

    it('resolves a two-dot parent-relative import to the parent directory module', () => {
      mkdirSync(join(projectRoot, 'pkg', 'sub'), { recursive: true });
      writeFileSync(join(projectRoot, 'pkg', 'shared.py'), 'X = 1\n');
      const importingFilePath = join(projectRoot, 'pkg', 'sub', 'caller.py');
      writeFileSync(importingFilePath, 'from ..shared import X\n');

      const resolved = resolvePythonImport('..shared', importingFilePath, projectRoot);

      expect(resolved).toBe(join(projectRoot, 'pkg', 'shared.py'));
    });

    it('resolves to the existing module.py, not a nonexistent same-named directory', () => {
      mkdirSync(join(projectRoot, 'pkg'), { recursive: true });
      writeFileSync(join(projectRoot, 'pkg', 'onlyfile.py'), 'Y = 2\n');
      const importingFilePath = join(projectRoot, 'pkg', 'caller.py');

      const resolved = resolvePythonImport('.onlyfile', importingFilePath, projectRoot);

      expect(resolved).toBe(join(projectRoot, 'pkg', 'onlyfile.py'));
    });
  });

  describe('bare-dot `from . import <name>` (adjacent bug 2: submodule vs __init__ symbol)', () => {
    // `from . import mod2` has no module-name segment of its own: the ONLY
    // naming information is the imported specifier itself. Real Python first
    // tries `mod2` as a submodule file, and only falls back to treating it as
    // a symbol already defined in the package's own __init__.py if no such
    // submodule exists. resolvePythonImport must do the same, deciding via
    // existsSync since there is no way to know which case applies without
    // checking disk.
    it('outcome 1: the name is a submodule file on disk -- resolves to the submodule, not __init__.py', () => {
      mkdirSync(join(projectRoot, 'pkg'), { recursive: true });
      writeFileSync(join(projectRoot, 'pkg', '__init__.py'), '');
      writeFileSync(join(projectRoot, 'pkg', 'mod2.py'), 'def something():\n    pass\n');
      const importingFilePath = join(projectRoot, 'pkg', 'user.py');
      writeFileSync(importingFilePath, 'from . import mod2\n');

      const resolved = resolvePythonImport('.', importingFilePath, projectRoot, ['mod2']);

      expect(resolved).toBe(join(projectRoot, 'pkg', 'mod2.py'));
      expect(resolved).not.toBe(join(projectRoot, 'pkg', '__init__.py'));
    });

    it('outcome 1b: the submodule is itself a package (has __init__.py, no mod2.py file) -- resolves to the submodule package', () => {
      mkdirSync(join(projectRoot, 'pkg', 'mod2'), { recursive: true });
      writeFileSync(join(projectRoot, 'pkg', '__init__.py'), '');
      writeFileSync(join(projectRoot, 'pkg', 'mod2', '__init__.py'), 'def something():\n    pass\n');
      const importingFilePath = join(projectRoot, 'pkg', 'user.py');

      const resolved = resolvePythonImport('.', importingFilePath, projectRoot, ['mod2']);

      expect(resolved).toBe(join(projectRoot, 'pkg', 'mod2', '__init__.py'));
    });

    it('outcome 2: the name is NOT a submodule file -- falls back to the package __init__.py', () => {
      mkdirSync(join(projectRoot, 'onlyinit'), { recursive: true });
      writeFileSync(join(projectRoot, 'onlyinit', '__init__.py'), 'def helper():\n    pass\n');
      // No onlyinit/helper.py and no onlyinit/helper/__init__.py on disk.
      const importingFilePath = join(projectRoot, 'onlyinit', 'user.py');
      writeFileSync(importingFilePath, 'from . import helper\n');

      const resolved = resolvePythonImport('.', importingFilePath, projectRoot, ['helper']);

      expect(resolved).toBe(join(projectRoot, 'onlyinit', '__init__.py'));
    });

    it('with no specifier names supplied, behaves exactly as before (falls straight to __init__.py)', () => {
      mkdirSync(join(projectRoot, 'pkg'), { recursive: true });
      writeFileSync(join(projectRoot, 'pkg', '__init__.py'), '');
      const importingFilePath = join(projectRoot, 'pkg', 'user.py');

      const resolved = resolvePythonImport('.', importingFilePath, projectRoot);

      expect(resolved).toBe(join(projectRoot, 'pkg', '__init__.py'));
    });
  });

  describe('absolute (project-rooted) imports', () => {
    it('(b) resolves an absolute dotted import to an existing package __init__.py', () => {
      mkdirSync(join(projectRoot, 'api', 'analyzers'), { recursive: true });
      writeFileSync(join(projectRoot, 'api', 'analyzers', '__init__.py'), '');
      const importingFilePath = join(projectRoot, 'main.py');

      const resolved = resolvePythonImport('api.analyzers', importingFilePath, projectRoot);

      expect(resolved).toBe(join(projectRoot, 'api', 'analyzers', '__init__.py'));
    });

    it('resolves an absolute dotted import to an existing module file', () => {
      mkdirSync(join(projectRoot, 'api', 'analyzers'), { recursive: true });
      writeFileSync(join(projectRoot, 'api', 'analyzers', 'analyzer.py'), 'class Analyzer:\n    pass\n');
      const importingFilePath = join(projectRoot, 'main.py');

      const resolved = resolvePythonImport('api.analyzers.analyzer', importingFilePath, projectRoot);

      expect(resolved).toBe(join(projectRoot, 'api', 'analyzers', 'analyzer.py'));
    });

    it('(a) returns undefined (no phantom edge) for an absolute import that does not exist anywhere on disk', () => {
      const importingFilePath = join(projectRoot, 'main.py');

      const resolved = resolvePythonImport('api.analyzers.nonexistent', importingFilePath, projectRoot);

      expect(resolved).toBeUndefined();
    });

    it('never resolves outside the project root even if a same-named file exists there', () => {
      // A directory structure that could tempt a naive resolver to walk
      // upward past projectRoot; resolvePythonImport must never do that.
      const importingFilePath = join(projectRoot, 'main.py');
      const resolved = resolvePythonImport('..outside', importingFilePath, projectRoot);
      expect(resolved).toBeUndefined();
    });
  });

  describe('site-packages exclusion (preserved from before this fix)', () => {
    it('never resolves into a site-packages directory even if the file exists there', () => {
      mkdirSync(join(projectRoot, 'venv', 'site-packages', 'requests'), { recursive: true });
      writeFileSync(join(projectRoot, 'venv', 'site-packages', 'requests', '__init__.py'), '');
      const importingFilePath = join(projectRoot, 'venv', 'site-packages', 'requests', 'caller.py');

      // A relative import from inside site-packages resolving to itself
      // must still be rejected by the exclusion filter.
      const resolved = resolvePythonImport('.__init__', importingFilePath, projectRoot);

      expect(resolved).toBeUndefined();
    });
  });

  describe('degenerate input', () => {
    it('returns undefined for an empty module name', () => {
      const resolved = resolvePythonImport('', join(projectRoot, 'main.py'), projectRoot);
      expect(resolved).toBeUndefined();
    });
  });
});
