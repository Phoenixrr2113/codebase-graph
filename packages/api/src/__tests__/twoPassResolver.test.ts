/**
 * Two-Pass Resolver Tests
 * Tests for symbol collection and relationship resolution
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  SymbolRegistry,
  collectSymbols,
  resolveRelationships,
  twoPassResolve,
  isBuiltIn,
  getResolutionSummary,
  type SymbolInfo,
} from '../services/twoPassResolver';
import type { ParsedFileEntities } from '@codegraph/graph';
import type { FunctionEntity, ClassEntity } from '@codegraph/types';

describe('Two-Pass Resolver', () => {
  describe('SymbolRegistry', () => {
    let registry: SymbolRegistry;

    beforeEach(() => {
      registry = new SymbolRegistry();
    });

    it('should register and find symbols by name', () => {
      registry.registerSymbol({
        name: 'myFunction',
        file: '/src/utils.ts',
        type: 'function',
        isExported: true,
        startLine: 10,
      });

      const found = registry.findSymbolByName('myFunction');

      expect(found).toHaveLength(1);
      expect(found[0].name).toBe('myFunction');
      expect(found[0].file).toBe('/src/utils.ts');
    });

    it('should handle duplicate symbol names across files', () => {
      registry.registerSymbol({
        name: 'helper',
        file: '/src/a.ts',
        type: 'function',
        isExported: true,
        startLine: 5,
      });
      registry.registerSymbol({
        name: 'helper',
        file: '/src/b.ts',
        type: 'function',
        isExported: true,
        startLine: 15,
      });

      const found = registry.findSymbolByName('helper');

      expect(found).toHaveLength(2);
    });

    it('should track exports by file', () => {
      registry.registerSymbol({
        name: 'publicFn',
        file: '/src/api.ts',
        type: 'function',
        isExported: true,
        startLine: 1,
      });
      registry.registerSymbol({
        name: 'privateFn',
        file: '/src/api.ts',
        type: 'function',
        isExported: false,
        startLine: 10,
      });

      const publicExport = registry.findExport('/src/api.ts', 'publicFn');
      const privateExport = registry.findExport('/src/api.ts', 'privateFn');

      expect(publicExport).toBeDefined();
      expect(publicExport?.name).toBe('publicFn');
      expect(privateExport).toBeUndefined();
    });

    it('should get all symbols for a file', () => {
      registry.registerSymbol({
        name: 'fn1',
        file: '/src/test.ts',
        type: 'function',
        isExported: true,
        startLine: 1,
      });
      registry.registerSymbol({
        name: 'fn2',
        file: '/src/test.ts',
        type: 'function',
        isExported: false,
        startLine: 10,
      });
      registry.registerSymbol({
        name: 'other',
        file: '/src/other.ts',
        type: 'function',
        isExported: true,
        startLine: 1,
      });

      const testSymbols = registry.getFileSymbols('/src/test.ts');

      expect(testSymbols).toHaveLength(2);
    });

    it('should count total symbols', () => {
      registry.registerSymbol({
        name: 'a',
        file: '/a.ts',
        type: 'function',
        isExported: true,
        startLine: 1,
      });
      registry.registerSymbol({
        name: 'b',
        file: '/b.ts',
        type: 'class',
        isExported: true,
        startLine: 1,
      });

      expect(registry.getSymbolCount()).toBe(2);
    });

    it('should clear the registry', () => {
      registry.registerSymbol({
        name: 'test',
        file: '/test.ts',
        type: 'function',
        isExported: true,
        startLine: 1,
      });

      registry.clear();

      expect(registry.getSymbolCount()).toBe(0);
      expect(registry.getAllFiles()).toHaveLength(0);
    });

    it('should register functions from parsed file', () => {
      const functions: FunctionEntity[] = [
        { name: 'fn1', startLine: 1, endLine: 10, isExported: true, isAsync: false },
        { name: 'fn2', startLine: 15, endLine: 25, isExported: false, isAsync: true },
      ];

      registry.registerFunctions('/src/file.ts', functions);

      expect(registry.getSymbolCount()).toBe(2);
      expect(registry.findSymbolByName('fn1')).toHaveLength(1);
      expect(registry.findSymbolByName('fn2')).toHaveLength(1);
    });

    it('should register classes from parsed file', () => {
      const classes: ClassEntity[] = [
        { name: 'MyClass', startLine: 1, endLine: 50, isExported: true },
      ];

      registry.registerClasses('/src/file.ts', classes);

      const found = registry.findSymbolByName('MyClass');
      expect(found).toHaveLength(1);
      expect(found[0].type).toBe('class');
    });
  });

  describe('collectSymbols', () => {
    it('should collect symbols from parsed files', () => {
      const parsedFiles: ParsedFileEntities[] = [
        {
          file: { path: '/src/utils.ts', name: 'utils.ts', extension: 'ts', loc: 50, lastModified: '', hash: 'abc' },
          functions: [
            { name: 'helper', startLine: 1, endLine: 10, isExported: true, isAsync: false },
          ],
          classes: [],
          interfaces: [],
          variables: [],
          types: [],
          imports: [],
          callEdges: [],
        },
      ];

      const registry = new SymbolRegistry();
      const count = collectSymbols(parsedFiles, registry);

      expect(count).toBe(1);
      expect(registry.findSymbolByName('helper')).toHaveLength(1);
    });

    it('should collect all entity types', () => {
      const parsedFiles: ParsedFileEntities[] = [
        {
          file: { path: '/src/app.ts', name: 'app.ts', extension: 'ts', loc: 100, lastModified: '', hash: 'xyz' },
          functions: [{ name: 'fn', startLine: 1, endLine: 5, isExported: true, isAsync: false }],
          classes: [{ name: 'Cls', startLine: 10, endLine: 50, isExported: true }],
          interfaces: [{ name: 'IFace', startLine: 60, endLine: 70, isExported: true }],
          variables: [{ name: 'VAR', line: 80, kind: 'const', isExported: true }],
          types: [{ name: 'MyType', line: 90, isExported: true }],
          imports: [],
          callEdges: [],
        },
      ];

      const registry = new SymbolRegistry();
      const count = collectSymbols(parsedFiles, registry);

      expect(count).toBe(5);
    });
  });

  describe('resolveRelationships', () => {
    it('should resolve call edges to registered symbols', () => {
      const registry = new SymbolRegistry();
      registry.registerSymbol({
        name: 'targetFn',
        file: '/src/target.ts',
        type: 'function',
        isExported: true,
        startLine: 1,
      });

      const parsedFiles: ParsedFileEntities[] = [
        {
          file: { path: '/src/caller.ts', name: 'caller.ts', extension: 'ts', loc: 20, lastModified: '', hash: '' },
          functions: [],
          classes: [],
          interfaces: [],
          variables: [],
          types: [],
          imports: [],
          callEdges: [{ callerId: 'callerFn', calleeId: 'targetFn', line: 5 }],
        },
      ];

      const result = resolveRelationships(parsedFiles, registry);

      expect(result.resolved).toBe(1);
      expect(result.unresolved).toBe(0);
    });

    it('should track unresolved references', () => {
      const registry = new SymbolRegistry();

      const parsedFiles: ParsedFileEntities[] = [
        {
          file: { path: '/src/caller.ts', name: 'caller.ts', extension: 'ts', loc: 20, lastModified: '', hash: '' },
          functions: [],
          classes: [],
          interfaces: [],
          variables: [],
          types: [],
          imports: [],
          callEdges: [{ callerId: 'fn', calleeId: 'unknownFn', line: 10 }],
        },
      ];

      const result = resolveRelationships(parsedFiles, registry);

      expect(result.resolved).toBe(0);
      expect(result.unresolved).toBe(1);
    });
  });

  describe('twoPassResolve', () => {
    it('should perform full two-pass resolution', () => {
      const parsedFiles: ParsedFileEntities[] = [
        {
          file: { path: '/src/a.ts', name: 'a.ts', extension: 'ts', loc: 30, lastModified: '', hash: '' },
          functions: [{ name: 'fnA', startLine: 1, endLine: 10, isExported: true, isAsync: false }],
          classes: [],
          interfaces: [],
          variables: [],
          types: [],
          imports: [],
          callEdges: [{ callerId: 'fnA', calleeId: 'fnB', line: 5 }],
        },
        {
          file: { path: '/src/b.ts', name: 'b.ts', extension: 'ts', loc: 20, lastModified: '', hash: '' },
          functions: [{ name: 'fnB', startLine: 1, endLine: 8, isExported: true, isAsync: false }],
          classes: [],
          interfaces: [],
          variables: [],
          types: [],
          imports: [],
          callEdges: [],
        },
      ];

      const result = twoPassResolve(parsedFiles);

      expect(result.totalSymbols).toBe(2);
      expect(result.resolvedRelationships).toBe(1);
      expect(result.symbolsByFile.size).toBe(2);
    });
  });

  describe('Utility Functions', () => {
    it('isBuiltIn should identify JavaScript built-ins', () => {
      expect(isBuiltIn('console')).toBe(true);
      expect(isBuiltIn('Math')).toBe(true);
      expect(isBuiltIn('JSON')).toBe(true);
      expect(isBuiltIn('Promise')).toBe(true);
      expect(isBuiltIn('myCustomFunction')).toBe(false);
    });

    it('getResolutionSummary should format result', () => {
      const result = {
        totalSymbols: 10,
        resolvedRelationships: 8,
        unresolvedReferences: 2,
        symbolsByFile: new Map([
          ['a.ts', []],
          ['b.ts', []],
        ]),
      };

      const summary = getResolutionSummary(result);

      expect(summary).toContain('Symbols: 10');
      expect(summary).toContain('Resolved: 8');
      expect(summary).toContain('Unresolved: 2');
      expect(summary).toContain('Files: 2');
    });
  });
});
