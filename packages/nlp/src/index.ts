/**
 * @codegraph/nlp
 *
 * Entity/relationship extraction from natural language text via OpenRouter LLMs.
 * Supports zero-shot and few-shot extraction, with a bridge to store results
 * directly in the knowledge graph (Kuzu).
 */

// Core extractor
export {
  EntityExtractor,
  ENTITY_TYPES,
  RELATIONSHIP_TYPES,
  VALID_ENTITY_TYPES,
  VALID_RELATIONSHIP_TYPES,
} from './extractor';
export type { ExtractorConfig } from './extractor';

// Extract-and-store bridge (extraction → knowledge graph)
export { extractAndStore, extractAndStoreBatch } from './extract-and-store';
export type { ExtractAndStoreConfig, ExtractAndStoreResult } from './extract-and-store';

// Re-export types for convenience
export type {
  Sample,
  AnnotatedSample,
  EntityAnnotation,
  RelationshipAnnotation,
  EntityType,
  RelationshipType,
} from '@codegraph/types';
