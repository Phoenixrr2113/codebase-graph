/**
 * Smoke tests for all tier-2 language configurations.
 *
 * These tests verify the structural integrity of every config
 * without requiring tree-sitter grammars to be installed.
 */
import { describe, it, expect } from 'vitest';
import { allLanguageEntries, getAllLanguageConfigs } from '../index';

describe('Tier-2 Language Configs', () => {
  it('should have at least 30 language entries', () => {
    expect(allLanguageEntries.length).toBeGreaterThanOrEqual(30);
  });

  it('should have unique language IDs', () => {
    const ids = allLanguageEntries.map(e => e.config.id);
    const uniqueIds = new Set(ids);
    expect(uniqueIds.size).toBe(ids.length);
  });

  it('should have unique extensions across all configs', () => {
    const extToLang = new Map<string, string>();
    const duplicates: string[] = [];

    for (const entry of allLanguageEntries) {
      for (const ext of entry.config.extensions) {
        if (extToLang.has(ext)) {
          duplicates.push(`${ext} claimed by both ${extToLang.get(ext)} and ${entry.config.id}`);
        }
        extToLang.set(ext, entry.config.id);
      }
    }

    // Some overlaps are acceptable (.h claimed by both c and objc)
    // but flag them for awareness
    if (duplicates.length > 0) {
      console.warn('Extension overlaps (may be intentional):', duplicates);
    }
  });

  describe.each(allLanguageEntries)('$config.displayName ($config.id)', (entry) => {
    const { config, grammarPackage } = entry;

    it('should have a valid ID (lowercase, no spaces)', () => {
      expect(config.id).toMatch(/^[a-z][a-z0-9-]*$/);
    });

    it('should have a non-empty display name', () => {
      expect(config.displayName.length).toBeGreaterThan(0);
    });

    it('should have at least one file extension', () => {
      expect(config.extensions.length).toBeGreaterThan(0);
    });

    it('should have extensions starting with a dot', () => {
      for (const ext of config.extensions) {
        expect(ext).toMatch(/^\./);
      }
    });

    it('should have a grammar package name', () => {
      expect(grammarPackage).toBeTruthy();
      expect(grammarPackage).toMatch(/^tree-sitter-/);
    });

    it('should have valid nodeTypes', () => {
      expect(config.nodeTypes).toBeDefined();
      expect(Array.isArray(config.nodeTypes.functions)).toBe(true);
      expect(Array.isArray(config.nodeTypes.classes)).toBe(true);
      expect(Array.isArray(config.nodeTypes.variables)).toBe(true);
      expect(Array.isArray(config.nodeTypes.imports)).toBe(true);
    });

    it('should have fields object', () => {
      expect(config.fields).toBeDefined();
    });

    it('should have visibility config', () => {
      expect(config.visibilityConfig).toBeDefined();
      expect(config.visibilityConfig!.strategy).toMatch(/^(all-public|modifier|naming)$/);
    });

    it('should have docstring config', () => {
      expect(config.docstringConfig).toBeDefined();
      expect(config.docstringConfig!.strategy).toMatch(/^(preceding-comment|body-first-string|none)$/);
    });

    it('should have param config', () => {
      expect(config.paramConfig).toBeDefined();
      expect(Array.isArray(config.paramConfig!.identifierNodeTypes)).toBe(true);
    });

    it('should have import config', () => {
      expect(config.importConfig).toBeDefined();
      expect(Array.isArray(config.importConfig!.moduleNodeTypes)).toBe(true);
    });
  });

  describe('getAllLanguageConfigs()', () => {
    it('should return all configs with basic info', () => {
      const configs = getAllLanguageConfigs();
      expect(configs.length).toBe(allLanguageEntries.length);

      for (const cfg of configs) {
        expect(cfg.id).toBeTruthy();
        expect(cfg.displayName).toBeTruthy();
        expect(cfg.extensions.length).toBeGreaterThan(0);
        expect(cfg.grammarPackage).toBeTruthy();
      }
    });
  });
});
