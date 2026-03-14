/**
 * Tests for language registration functions.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { registerAllLanguages, registerLanguage, allLanguageEntries } from '../index';
import { clearGrammarCache } from '../grammar-loader';
import type { LanguagePlugin } from '@codegraph/types';

/** Mock registry that tracks registrations */
class MockRegistry {
  registered: LanguagePlugin[] = [];

  register(plugin: LanguagePlugin): void {
    this.registered.push(plugin);
  }
}

describe('Language Registration', () => {
  beforeEach(() => {
    clearGrammarCache();
  });

  describe('registerAllLanguages()', () => {
    it('should return registered and skipped arrays', async () => {
      const registry = new MockRegistry();
      const result = await registerAllLanguages(registry);

      expect(Array.isArray(result.registered)).toBe(true);
      expect(Array.isArray(result.skipped)).toBe(true);

      // Total should equal all entries
      expect(result.registered.length + result.skipped.length).toBe(
        allLanguageEntries.length
      );
    });

    it('should skip languages with unavailable grammars', async () => {
      const registry = new MockRegistry();
      const result = await registerAllLanguages(registry);

      // Since we likely don't have any tier-2 grammars installed in test env,
      // most should be skipped
      expect(result.skipped.length).toBeGreaterThan(0);
    });

    it('should register plugins in the provided registry', async () => {
      const registry = new MockRegistry();
      const result = await registerAllLanguages(registry);

      // The number of registered plugins should match the count
      expect(registry.registered.length).toBe(result.registered.length);

      // Each registered plugin should have the required interface
      for (const plugin of registry.registered) {
        expect(plugin.id).toBeTruthy();
        expect(plugin.displayName).toBeTruthy();
        expect(plugin.extensions.length).toBeGreaterThan(0);
        expect(typeof plugin.getGrammar).toBe('function');
        expect(plugin.extractors).toBeDefined();
      }
    });
  });

  describe('registerLanguage()', () => {
    it('should return false for unknown language IDs', async () => {
      const registry = new MockRegistry();
      const result = await registerLanguage(registry, 'nonexistent-language');
      expect(result).toBe(false);
    });

    it('should attempt to register a known language', async () => {
      const registry = new MockRegistry();
      // Try to register ruby — will return false if grammar not installed
      const result = await registerLanguage(registry, 'ruby');
      expect(typeof result).toBe('boolean');
    });
  });
});
