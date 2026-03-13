/**
 * @codegraph/plugin-nlp
 *
 * Entity/relationship extraction from natural language text via OpenRouter LLMs.
 * Supports zero-shot and few-shot extraction, with a bridge to store results
 * directly in the knowledge graph (FalkorDB).
 *
 * Two-tier embedding generation: local (nomic-embed-text-v1.5, 768-dim, free)
 * or cloud (OpenRouter, 1536-dim, opt-in).
 *
 * Guided Open Taxonomy: preferred types are provided as guidance to the LLM,
 * but new types can be proposed when nothing fits. Synonym normalization
 * reduces type drift automatically.
 */

// Centralized LLM model factory (multi-provider: OpenRouter, Ollama)
export {
  getLLMModel,
  getLLMComplexModel,
  getLLMModelSync,
  getLLMModelName,
  getLLMProvider,
  getLLMConfigResolved,
  isLLMAvailable,
  isComplexLLMAvailable,
  warmupLLM,
  withRetry,
} from './llm';
export type { LLMProvider, LLMConfig } from './llm';

// Zod schemas for structured LLM output (extraction + WS12 search types)
export {
  ExtractionResponseSchema,
  BatchExtractionResponseSchema,
  GraphAnswerSchema,
  NLToCypherSchema,
  SearchRouteSchema,
  ContextWalkStepSchema,
} from './schemas';
export type {
  ExtractionResponse,
  BatchExtractionResponse,
  GraphAnswer,
  NLToCypher,
  SearchRoute,
  ContextWalkStep,
} from './schemas';

// Core extractor
export { EntityExtractor } from './extractor';
export type { ExtractorConfig } from './extractor';

// Extract-and-store bridge (extraction → knowledge graph)
export { extractAndStore, extractAndStoreBatch, extractConversation, ingestConversation } from './extract-and-store';
export type {
  ExtractAndStoreConfig, ExtractAndStoreResult,
  ConversationExtractionConfig, ConversationExtractionResult,
  IngestConversationConfig, IngestConversationResult,
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
  warmupEmbedding,
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

// Temporal conflict resolution (contradiction detection + edge invalidation)
export { checkAndResolveConflicts } from './conflict-resolution';
export type {
  ConflictResolutionConfig, ConflictResolutionResult,
  ConflictCandidate, ConflictResult,
} from './conflict-resolution';

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

// Re-export types and taxonomy utilities for convenience
export type {
  Sample,
  AnnotatedSample,
  EntityAnnotation,
  RelationshipAnnotation,
  EntityType,
  RelationshipType,
  TypeDescription,
  KnowledgeDomain,
} from '@codegraph/types';

export {
  CORE_ENTITY_TYPES,
  SE_ENTITY_TYPES,
  CORE_RELATIONSHIP_TYPES,
  SE_RELATIONSHIP_TYPES,
  getPreferredEntityTypes,
  getPreferredRelationshipTypes,
  normalizeEntityType,
  normalizeRelationshipType,
  ENTITY_TYPE_SYNONYMS,
  RELATIONSHIP_TYPE_SYNONYMS,
} from '@codegraph/types';
