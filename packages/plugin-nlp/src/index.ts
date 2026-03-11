/**
 * @codegraph/plugin-nlp
 *
 * Entity/relationship extraction from natural language text via OpenRouter LLMs.
 * Supports zero-shot and few-shot extraction, with a bridge to store results
 * directly in the knowledge graph (FalkorDB).
 *
 * Two-tier embedding generation: local (nomic-embed-text-v1.5, 768-dim, free)
 * or cloud (OpenRouter, 1536-dim, opt-in).
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
export { extractAndStore, extractAndStoreBatch, extractConversation } from './extract-and-store';
export type {
  ExtractAndStoreConfig, ExtractAndStoreResult,
  ConversationExtractionConfig, ConversationExtractionResult,
} from './extract-and-store';

// Bridge linker (knowledge entities → code graph via ABOUT edges)
export { linkEntitiesToCode, linkByEmbedding } from './bridge-linker';
export type {
  BridgeLinkerInput, BridgeLinkResult, BridgeLinkerConfig,
  EmbeddingLinkConfig, EmbeddingLinkResult,
} from './bridge-linker';

// Embedding generation (two-tier: local + cloud)
export {
  generateEmbedding,
  generateEmbeddings,
  getEmbeddingDimensions,
  getEmbeddingProvider,
  isEmbeddingAvailable,
} from './embeddings';
export type {
  EmbeddingProvider,
  EmbeddingConfig,
  EmbeddingResult,
  EmbeddingBatchResult,
} from './embeddings';

// Conversation chunking (episodic processing)
export { chunkConversation } from './conversation';
export type { Episode, ConversationFormat, ChunkOptions, ChunkResult } from './conversation';

// Entity resolution (cross-episode deduplication)
export { resolveEntities } from './entity-resolution';
export type { EntityResolutionConfig, EntityResolutionResult } from './entity-resolution';

// Embedding text construction (node → searchable natural language)
export {
  buildFunctionEmbeddingText,
  buildClassEmbeddingText,
  buildInterfaceEmbeddingText,
  buildComponentEmbeddingText,
  buildTypeEmbeddingText,
  buildVariableEmbeddingText,
  buildFileEmbeddingText,
  buildEntityEmbeddingText,
  buildEmbeddingText,
} from './embedding-text';
export type { EmbeddableNodeType } from './embedding-text';

// Re-export types for convenience
export type {
  Sample,
  AnnotatedSample,
  EntityAnnotation,
  RelationshipAnnotation,
  EntityType,
  RelationshipType,
} from '@codegraph/types';
