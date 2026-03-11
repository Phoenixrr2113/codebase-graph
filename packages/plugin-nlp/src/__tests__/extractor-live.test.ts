/**
 * EntityExtractor — Live LLM Integration Tests
 *
 * Tests extraction with real LLM calls via OpenRouter.
 * Requires OPENROUTER_API_KEY environment variable.
 *
 * These tests verify that the generateObject + Zod schema pipeline
 * works end-to-end with a real model, producing correctly structured
 * and grounded entity/relationship output.
 */

import { describe, it, expect } from 'vitest';
import { EntityExtractor } from '../extractor';
import { isLLMAvailable } from '../llm';
import type { Sample, AnnotatedSample } from '@codegraph/types';

const SKIP = !isLLMAvailable();

function makeSample(text: string, id?: string): Sample {
  return { id: id ?? `live-${Date.now()}`, text };
}

describe.skipIf(SKIP)('EntityExtractor — live LLM', () => {
  it('should extract entities from a simple sentence', async () => {
    const extractor = new EntityExtractor();
    const sample = makeSample(
      'Sarah decided to refactor the authentication module using JWT tokens.',
    );
    const result = await extractor.extract(sample);

    // Should find at least Sarah and some code-related entities
    expect(result.entities.length).toBeGreaterThanOrEqual(1);
    expect(result.annotatedBy).toBe('auto');
    expect(result.modelVersion).toBeTruthy();

    // At least one entity should be a Person
    const personEntities = result.entities.filter((e) => e.type === 'Person');
    expect(personEntities.length).toBeGreaterThanOrEqual(1);
    expect(personEntities.some((e) => e.text === 'Sarah')).toBe(true);

    // All entities should be grounded in the text (start/end offsets are valid)
    for (const entity of result.entities) {
      expect(entity.start).toBeGreaterThanOrEqual(0);
      expect(entity.end).toBeGreaterThan(entity.start);
      expect(sample.text.slice(entity.start, entity.end)).toBe(entity.text);
    }
  }, 30_000);

  it('should extract relationships between entities', async () => {
    const extractor = new EntityExtractor();
    const sample = makeSample(
      'Alice created the payment service and Bob reviewed it before deployment.',
    );
    const result = await extractor.extract(sample);

    // Should find Alice and Bob as persons
    const persons = result.entities.filter((e) => e.type === 'Person');
    expect(persons.length).toBeGreaterThanOrEqual(2);

    // Should find at least one relationship
    expect(result.relationships.length).toBeGreaterThanOrEqual(1);

    // Relationships should reference valid entity IDs
    for (const rel of result.relationships) {
      const head = result.entities.find((e) => e.id === rel.headEntityId);
      const tail = result.entities.find((e) => e.id === rel.tailEntityId);
      expect(head).toBeDefined();
      expect(tail).toBeDefined();
      expect(rel.type).toBeTruthy();
    }
  }, 30_000);

  it('should handle context-aware extraction', async () => {
    const extractor = new EntityExtractor();
    const context = 'Sarah: I\'ll be working on the payment module this sprint.';
    const sample = makeSample(
      'Bob: She should also fix the retry logic in that module.',
    );

    const result = await extractor.extractWithContext(sample, context);

    // Should extract entities from current message
    expect(result.entities.length).toBeGreaterThanOrEqual(1);

    // All entities should be grounded in the current text (not context)
    for (const entity of result.entities) {
      expect(entity.start).toBeGreaterThanOrEqual(0);
      expect(entity.end).toBeGreaterThan(entity.start);
      expect(sample.text.slice(entity.start, entity.end)).toBe(entity.text);
    }
  }, 30_000);

  it('should extract with few-shot examples', async () => {
    const example: AnnotatedSample = {
      id: 'ex-1',
      text: 'John decided to use React for the frontend',
      entities: [
        { id: 'e-0', start: 0, end: 4, text: 'John', type: 'Person', confidence: 1.0 },
        { id: 'e-1', start: 22, end: 27, text: 'React', type: 'CodeEntity', confidence: 1.0 },
      ],
      relationships: [
        { id: 'r-0', headEntityId: 'e-0', tailEntityId: 'e-1', type: 'DECIDED', confidence: 1.0 },
      ],
      annotatedBy: 'human',
      annotatedAt: '2024-01-01T00:00:00Z',
    };

    const extractor = new EntityExtractor();
    const sample = makeSample('Alice chose to use TypeScript for the backend');
    const result = await extractor.extractWithExamples(sample, [example]);

    // Should find at least Alice and TypeScript
    expect(result.entities.length).toBeGreaterThanOrEqual(2);

    // All entities should be grounded
    for (const entity of result.entities) {
      expect(entity.start).toBeGreaterThanOrEqual(0);
      expect(sample.text.slice(entity.start, entity.end)).toBe(entity.text);
    }
  }, 30_000);

  it('should handle software engineering text with domain types', async () => {
    const extractor = new EntityExtractor({ domain: 'se' });
    const sample = makeSample(
      'The team identified a critical bug in the GraphQL resolver that causes a timeout when querying nested relationships.',
    );
    const result = await extractor.extract(sample);

    // Should find multiple entities in a technical context
    expect(result.entities.length).toBeGreaterThanOrEqual(2);

    // Log what we found for visibility
    console.log('Entities found:', result.entities.map((e) => `[${e.type}] "${e.text}"`));
    if (result.relationships.length > 0) {
      console.log('Relationships found:', result.relationships.map((r) => {
        const head = result.entities.find((e) => e.id === r.headEntityId);
        const tail = result.entities.find((e) => e.id === r.tailEntityId);
        return `"${head?.text}" --${r.type}--> "${tail?.text}"`;
      }));
    }
  }, 30_000);
});
