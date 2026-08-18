/**
 * EntityExtractor: Unit Tests
 *
 * Uses MockLanguageModelV3 from ai/test to mock LLM responses.
 * Tests zero-shot, few-shot, and batch extraction modes.
 */

import { describe, it, expect } from 'vitest';
import { MockLanguageModelV3 } from 'ai/test';
import { EntityExtractor } from '../extractor';
import type { Sample, AnnotatedSample } from '@codegraph/types';
import { makeToolCallModel } from './helpers/mock-tool-call-model';

// ============================================================================
// Helpers
// ============================================================================

function makeSample(text: string, id?: string): Sample {
  return { id: id ?? 'test-sample', text };
}

// ============================================================================
// Zero-shot extraction
// ============================================================================

describe('EntityExtractor: zero-shot', () => {
  it('should extract entities and relationships from text', async () => {
    const mockModel = makeToolCallModel({
      entities: [
        { text: 'Randy', type: 'Person' },
        { text: 'Kuzu', type: 'CodeEntity' },
      ],
      relationships: [
        { headText: 'Randy', tailText: 'Kuzu', type: 'CREATED' },
      ],
    });

    const extractor = new EntityExtractor({ languageModel: mockModel });
    const sample = makeSample('Randy created Kuzu for graph storage');
    const result = await extractor.extract(sample);

    expect(result.entities).toHaveLength(2);
    expect(result.entities[0]!.text).toBe('Randy');
    expect(result.entities[0]!.type).toBe('Person');
    expect(result.entities[1]!.text).toBe('Kuzu');
    expect(result.entities[1]!.type).toBe('CodeEntity');

    expect(result.relationships).toHaveLength(1);
    expect(result.relationships[0]!.type).toBe('CREATED');

    expect(result.annotatedBy).toBe('auto');
    expect(result.annotatedAt).toBeTruthy();
  });

  it('should normalize entity type synonyms', async () => {
    const mockModel = makeToolCallModel({
      entities: [
        { text: 'Randy', type: 'Person' },
        { text: 'something', type: 'defect' },
      ],
      relationships: [],
    });

    const extractor = new EntityExtractor({ languageModel: mockModel });
    const result = await extractor.extract(makeSample('Randy found something'));

    // Both entities should pass: synonym "defect" normalizes to "Bug"
    expect(result.entities).toHaveLength(2);
    expect(result.entities[0]!.type).toBe('Person');
    expect(result.entities[1]!.type).toBe('Bug');
  });

  it('should pass through novel entity and relationship types', async () => {
    const mockModel = makeToolCallModel({
      entities: [
        { text: 'Alice', type: 'Person' },
        { text: 'Bob', type: 'Person' },
        { text: 'hypothesis', type: 'Hypothesis' },
      ],
      relationships: [
        { headText: 'Alice', tailText: 'Bob', type: 'KNOWS' },
        { headText: 'Alice', tailText: 'hypothesis', type: 'PROPOSED' },
      ],
    });

    const extractor = new EntityExtractor({ languageModel: mockModel });
    const result = await extractor.extract(makeSample('Alice knows Bob and proposed a hypothesis'));

    // Novel types pass through (guided open taxonomy)
    expect(result.entities).toHaveLength(3);
    expect(result.entities[2]!.type).toBe('Hypothesis');
    expect(result.relationships).toHaveLength(2);
    expect(result.relationships[0]!.type).toBe('KNOWS');
    expect(result.relationships[1]!.type).toBe('PROPOSED');
  });

  it('should normalize relationship type synonyms', async () => {
    const mockModel = makeToolCallModel({
      entities: [
        { text: 'Alice', type: 'Person' },
        { text: 'Bob', type: 'Person' },
      ],
      relationships: [
        { headText: 'Alice', tailText: 'Bob', type: 'KNOWS' },
        { headText: 'Alice', tailText: 'Bob', type: 'fixes' },
      ],
    });

    const extractor = new EntityExtractor({ languageModel: mockModel });
    const result = await extractor.extract(makeSample('Alice knows Bob'));

    // "fixes" is a synonym for SOLVES
    expect(result.relationships).toHaveLength(2);
    expect(result.relationships[0]!.type).toBe('KNOWS');
    expect(result.relationships[1]!.type).toBe('SOLVES');
  });

  it('should skip entities whose text is not found in the sample', async () => {
    const mockModel = makeToolCallModel({
      entities: [
        { text: 'Randy', type: 'Person' },
        { text: 'NotInText', type: 'Concept' },
      ],
      relationships: [],
    });

    const extractor = new EntityExtractor({ languageModel: mockModel });
    const result = await extractor.extract(makeSample('Randy works on graphs'));

    expect(result.entities).toHaveLength(1);
    expect(result.entities[0]!.text).toBe('Randy');
  });

  it('should handle empty LLM response gracefully', async () => {
    const mockModel = new MockLanguageModelV3({
      provider: 'test',
      modelId: 'test-model',
      doGenerate: {
        content: [{ type: 'text' as const, text: 'No JSON here, just text.' }],
        finishReason: { unified: 'stop' as const, raw: 'stop' },
        usage: {
          inputTokens: { total: 5, noCache: 5, cacheRead: 0, cacheWrite: 0 },
          outputTokens: { total: 5, text: 5, reasoning: 0 },
        },
        warnings: [],
      },
    });

    const extractor = new EntityExtractor({ languageModel: mockModel });
    const result = await extractor.extract(makeSample('some text'));

    expect(result.entities).toHaveLength(0);
    expect(result.relationships).toHaveLength(0);
  });

  it('should compute correct start/end offsets for entities', async () => {
    const text = 'Alice met Bob at the conference';
    const mockModel = makeToolCallModel({
      entities: [
        { text: 'Alice', type: 'Person' },
        { text: 'Bob', type: 'Person' },
        { text: 'conference', type: 'Event' },
      ],
      relationships: [],
    });

    const extractor = new EntityExtractor({ languageModel: mockModel });
    const result = await extractor.extract(makeSample(text));

    expect(result.entities[0]!.start).toBe(0);
    expect(result.entities[0]!.end).toBe(5);
    expect(result.entities[1]!.start).toBe(10);
    expect(result.entities[1]!.end).toBe(13);
    expect(result.entities[2]!.start).toBe(21);
    expect(result.entities[2]!.end).toBe(31);
  });
});

// ============================================================================
// Few-shot extraction
// ============================================================================

describe('EntityExtractor: few-shot (extractWithExamples)', () => {
  const exampleSample: AnnotatedSample = {
    id: 'example-1',
    text: 'John decided to use React',
    entities: [
      { id: 'e-0', start: 0, end: 4, text: 'John', type: 'Person', confidence: 1.0 },
      { id: 'e-1', start: 19, end: 24, text: 'React', type: 'CodeEntity', confidence: 1.0 },
    ],
    relationships: [
      { id: 'r-0', headEntityId: 'e-0', tailEntityId: 'e-1', type: 'DECIDED', confidence: 1.0 },
    ],
    annotatedBy: 'human',
    annotatedAt: '2024-01-01T00:00:00Z',
  };

  it('should extract using few-shot examples', async () => {
    const mockModel = makeToolCallModel({
      entities: [
        { text: 'Sarah', type: 'Person' },
        { text: 'Vue', type: 'CodeEntity' },
      ],
      relationships: [
        { headText: 'Sarah', tailText: 'Vue', type: 'DECIDED' },
      ],
    });

    const extractor = new EntityExtractor({ languageModel: mockModel });
    const sample = makeSample('Sarah decided to use Vue');
    const result = await extractor.extractWithExamples(sample, [exampleSample]);

    expect(result.entities).toHaveLength(2);
    expect(result.relationships).toHaveLength(1);
    expect(result.relationships[0]!.type).toBe('DECIDED');
  });

  it('should fall back to zero-shot when no examples given', async () => {
    const mockModel = makeToolCallModel({
      entities: [{ text: 'test', type: 'Concept' }],
      relationships: [],
    });

    const extractor = new EntityExtractor({ languageModel: mockModel });
    const result = await extractor.extractWithExamples(makeSample('test input'), []);

    // Should still work (falls back to extract())
    expect(result.entities).toHaveLength(1);
  });

  it('should include example formatting in the prompt', async () => {
    const calls: string[] = [];

    const mockModel = new MockLanguageModelV3({
      provider: 'test',
      modelId: 'test-model',
      doGenerate: async (options: { prompt: Array<{ type: string; content?: string | Array<{ type: string; text: string }> }> }) => {
        // Capture the prompt text
        const part = options.prompt[0];
        if (part && 'content' in part) {
          if (typeof part.content === 'string') {
            calls.push(part.content);
          } else if (Array.isArray(part.content)) {
            for (const c of part.content) {
              if (c.type === 'text') calls.push(c.text);
            }
          }
        }

        return {
          content: [{
            type: 'tool-call' as const,
            toolCallId: 'test-tool-call-1',
            toolName: 'emit_extraction',
            input: '{"entities":[],"relationships":[]}',
          }],
          finishReason: { unified: 'tool-calls' as const, raw: 'tool-calls' },
          usage: {
            inputTokens: { total: 10, noCache: 10, cacheRead: 0, cacheWrite: 0 },
            outputTokens: { total: 5, text: 0, reasoning: 0 },
          },
          warnings: [],
        };
      },
    });

    const extractor = new EntityExtractor({ languageModel: mockModel });
    await extractor.extractWithExamples(makeSample('test'), [exampleSample]);

    // The prompt should contain the example text and "Human-Labeled Examples"
    const prompt = calls.join(' ');
    expect(prompt).toContain('Human-Labeled Examples');
    expect(prompt).toContain('John decided to use React');
    expect(prompt).toContain('[Person] "John"');
    expect(prompt).toContain('--DECIDED-->');
  });
});

// ============================================================================
// Batch extraction
// ============================================================================

describe('EntityExtractor: batch', () => {
  it('should extract from multiple samples in one call', async () => {
    const mockModel = makeToolCallModel({
      results: [
        {
          sampleId: 's1',
          entities: [{ text: 'Alice', type: 'Person' }],
          relationships: [],
        },
        {
          sampleId: 's2',
          entities: [{ text: 'Project X', type: 'Project' }],
          relationships: [],
        },
      ],
    }, 'emit_batch');

    const extractor = new EntityExtractor({ languageModel: mockModel });
    const results = await extractor.extractBatch([
      makeSample('Alice joined the team', 's1'),
      makeSample('Project X launched today', 's2'),
    ]);

    expect(results).toHaveLength(2);
    expect(results[0]!.entities[0]!.text).toBe('Alice');
    expect(results[1]!.entities[0]!.text).toBe('Project X');
  });
});
