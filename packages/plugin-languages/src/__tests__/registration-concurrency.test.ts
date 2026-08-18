import type { LanguagePlugin } from '@codegraph/types';
import { describe, expect, it, vi } from 'vitest';

const grammarLoaderMock = vi.hoisted(() => ({
  clearGrammarCache: vi.fn(),
  loadGrammar: vi.fn(),
}));

vi.mock('../grammar-loader', () => grammarLoaderMock);

import { allLanguageEntries, registerAllLanguages } from '../index';

class MockRegistry {
  readonly registered: LanguagePlugin[] = [];

  register(plugin: LanguagePlugin): void {
    this.registered.push(plugin);
  }
}

describe('registerAllLanguages concurrency', () => {
  it('starts grammar loads concurrently while preserving registration order', async () => {
    let startedLoads = 0;
    let releaseLoads: (() => void) | undefined;
    const loadersCanFinish = new Promise<void>((resolve) => {
      releaseLoads = resolve;
    });

    grammarLoaderMock.loadGrammar.mockImplementation(async (grammarPackage: string) => {
      startedLoads += 1;
      if (startedLoads === 2) releaseLoads?.();
      await loadersCanFinish;

      return grammarPackage === 'tree-sitter-php' ? { php: {} } : {};
    });

    const registry = new MockRegistry();
    const registration = registerAllLanguages(registry);

    try {
      expect(startedLoads).toBe(allLanguageEntries.length);
    } finally {
      releaseLoads?.();
      await registration;
    }

    const result = await registration;
    expect(result.registered).toEqual(allLanguageEntries.map((entry) => entry.config.id));
    expect(registry.registered.map((plugin) => plugin.id)).toEqual(result.registered);
  });
});
