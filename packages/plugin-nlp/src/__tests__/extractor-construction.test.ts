/**
 * EntityExtractor construction — Regression tests
 *
 * Verifies that the EntityExtractor constructor does NOT synchronously
 * resolve the LLM model (which previously called getLLMModelSync and blew
 * up with either "only supports openrouter" or "require is not defined"
 * depending on the provider).
 */

import { describe, it, expect } from 'vitest';
import { EntityExtractor } from '../extractor';

describe('EntityExtractor construction', () => {
  it('does not throw on construction with LLM_PROVIDER=cerebras', () => {
    const prev = process.env['LLM_PROVIDER'];
    process.env['LLM_PROVIDER'] = 'cerebras';
    try {
      const extractor = new EntityExtractor();
      expect(extractor).toBeDefined();
    } finally {
      if (prev === undefined) delete process.env['LLM_PROVIDER'];
      else process.env['LLM_PROVIDER'] = prev;
    }
  });

  it('does not throw on construction with LLM_PROVIDER=openrouter', () => {
    const prev = process.env['LLM_PROVIDER'];
    process.env['LLM_PROVIDER'] = 'openrouter';
    try {
      const extractor = new EntityExtractor();
      expect(extractor).toBeDefined();
    } finally {
      if (prev === undefined) delete process.env['LLM_PROVIDER'];
      else process.env['LLM_PROVIDER'] = prev;
    }
  });

  it('does not throw on construction with LLM_PROVIDER=ollama', () => {
    const prev = process.env['LLM_PROVIDER'];
    process.env['LLM_PROVIDER'] = 'ollama';
    try {
      const extractor = new EntityExtractor();
      expect(extractor).toBeDefined();
    } finally {
      if (prev === undefined) delete process.env['LLM_PROVIDER'];
      else process.env['LLM_PROVIDER'] = prev;
    }
  });
});
