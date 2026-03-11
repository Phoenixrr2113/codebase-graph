/**
 * Extract-and-Store bridge
 *
 * Connects the NLP extraction layer (@codegraph/plugin-nlp) with the knowledge graph
 * storage layer (@codegraph/graph). Extracts entities and relationships from
 * natural language text, then stores them in the knowledge graph (FalkorDB).
 *
 * Two modes:
 * 1. Zero-shot: Uses EntityExtractor.extract() — no examples needed
 * 2. Few-shot:  Uses EntityExtractor.extractWithExamples() — learns from labeled examples
 */

import { createLogger } from '@codegraph/logger';
import type { Sample, AnnotatedSample } from '@codegraph/types';
import type { GraphClient, KnowledgeOperations, KnowledgeEntity } from '@codegraph/graph';
import { EntityExtractor, type ExtractorConfig } from './extractor';
import { buildEntityEmbeddingText } from './embedding-text';
import { generateEmbeddings, isEmbeddingAvailable, type EmbeddingConfig } from './embeddings';
import { linkEntitiesToCode, type BridgeLinkResult } from './bridge-linker';
import type { ChunkResult, Episode } from './conversation';

const logger = createLogger({ namespace: 'nlp:extract-and-store' });

// ============================================================================
// Types
// ============================================================================

export interface ExtractAndStoreConfig {
  /** LLM config for the EntityExtractor */
  extractor?: Partial<ExtractorConfig>;

  /** If provided, uses few-shot extraction with these labeled examples */
  examples?: AnnotatedSample[];

  /** Confidence threshold — skip entities below this (default: 0.5) */
  minConfidence?: number;

  /** Batch size for batch extraction (default: 10) */
  batchSize?: number;

  /** Embedding configuration. Set to false to disable embedding generation.
   *  Undefined = try local embedding if available. */
  embeddings?: EmbeddingConfig | false;

  /** GraphClient for bridge linking (auto-create ABOUT edges from entities to code nodes).
   *  If provided, after entities are stored, the bridge linker will check if any entity
   *  text matches known code symbol names and create ABOUT edges. */
  graphClient?: GraphClient;

  /** Prior context for context-aware extraction (episodic processing).
   *  When provided, the extractor uses this text to resolve pronouns and references
   *  but only extracts entities from the primary text. */
  context?: string | undefined;
}

export interface ExtractAndStoreResult {
  /** Number of entities stored */
  entities: number;
  /** Number of relationships stored */
  relationships: number;
  /** Sample ID used for provenance tracking */
  sampleId: string;
  /** The annotated sample returned by the extractor */
  annotated: AnnotatedSample;
  /** Number of items that had embeddings generated */
  embedded?: number;
  /** Bridge linking result (if graphClient was provided) */
  bridgeLinked?: BridgeLinkResult;
}

// ============================================================================
// Single text → extract → store
// ============================================================================

/**
 * Extract entities and relationships from text and store them in the knowledge graph.
 *
 * @param text - Natural language text to process
 * @param ops  - Knowledge graph operations instance
 * @param config - Optional extraction configuration
 * @returns Result with counts and the annotated sample
 */
export async function extractAndStore(
  text: string,
  ops: KnowledgeOperations,
  config: ExtractAndStoreConfig = {}
): Promise<ExtractAndStoreResult> {
  const extractor = new EntityExtractor(config.extractor);
  const minConfidence = config.minConfidence ?? 0.5;

  // Create a sample from the raw text
  const sampleId = `sample-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const sample: Sample = {
    id: sampleId,
    text,
    source: 'auto',
    createdAt: new Date().toISOString(),
  };

  logger.debug(`extractAndStore: sampleId=${sampleId}, textLen=${text.length}`);

  // Extract using context-aware, few-shot, or zero-shot mode
  let annotated: AnnotatedSample;
  if (config.context) {
    // Context-aware extraction (episodic processing) — use prior messages for pronoun resolution
    annotated = await extractor.extractWithContext(sample, config.context);
  } else if (config.examples && config.examples.length > 0) {
    annotated = await extractor.extractWithExamples(sample, config.examples);
  } else {
    annotated = await extractor.extract(sample);
  }

  // Filter by confidence threshold
  const entities = annotated.entities.filter((e) => e.confidence >= minConfidence);
  const relationships = annotated.relationships.filter((r) => r.confidence >= minConfidence);

  logger.debug(
    `Extracted ${entities.length} entities, ${relationships.length} relationships (threshold: ${minConfidence})`
  );

  // Store in knowledge graph via importEntitiesAndRelationships
  const kgEntities: KnowledgeEntity[] = entities.map((e) => ({
    text: e.text,
    type: e.type,
    confidence: e.confidence,
    sampleId,
  }));

  const kgRelationships = relationships.map((r) => {
    const head = annotated.entities.find((e) => e.id === r.headEntityId);
    const tail = annotated.entities.find((e) => e.id === r.tailEntityId);

    return {
      headText: head?.text ?? '',
      headType: head?.type ?? 'Concept',
      tailText: tail?.text ?? '',
      tailType: tail?.type ?? 'Concept',
      type: r.type,
      confidence: r.confidence,
      sampleId,
    };
  }).filter((r) => r.headText && r.tailText);

  // Embedding pass — generate embeddings for entities and relationship facts
  let totalEmbedded = 0;
  const embeddingConfig = config.embeddings === false ? undefined : config.embeddings;
  if (config.embeddings !== false && isEmbeddingAvailable(embeddingConfig)) {
    try {
      totalEmbedded = await generateKnowledgeEmbeddings(kgEntities, kgRelationships, embeddingConfig);
    } catch (err) {
      // Embedding failures are non-fatal — entities are still stored without embeddings
      logger.warn(`Embedding generation failed for sampleId=${sampleId}: ${err}`);
    }
  }

  const result = await ops.importEntitiesAndRelationships(kgEntities, kgRelationships, sampleId);

  const embedMsg = totalEmbedded > 0 ? `, ${totalEmbedded} embedded` : '';
  logger.info(
    `Stored ${result.entities} entities, ${result.relationships} relationships${embedMsg} (sampleId: ${sampleId})`
  );

  // Bridge linking — auto-create ABOUT edges from entities to code nodes
  let bridgeResult: BridgeLinkResult | undefined;
  if (config.graphClient && kgEntities.length > 0) {
    try {
      bridgeResult = await linkEntitiesToCode(
        kgEntities.map((e) => ({ text: e.text, type: e.type })),
        config.graphClient,
        ops,
      );
    } catch (err) {
      // Bridge linking is non-fatal — entities are still stored
      logger.warn(`Bridge linking failed for sampleId=${sampleId}: ${err}`);
    }
  }

  const storeResult: ExtractAndStoreResult = {
    entities: result.entities,
    relationships: result.relationships,
    sampleId,
    annotated,
  };
  if (totalEmbedded > 0) storeResult.embedded = totalEmbedded;
  if (bridgeResult) storeResult.bridgeLinked = bridgeResult;
  return storeResult;
}

// ============================================================================
// Embedding helper
// ============================================================================

/**
 * Generate embeddings for knowledge entities and relationship facts in-place.
 * Mutates the arrays, attaching `.embedding` / `.factEmbedding`.
 * Returns the total number of items successfully embedded.
 */
async function generateKnowledgeEmbeddings(
  kgEntities: KnowledgeEntity[],
  kgRelationships: { factEmbedding?: number[] | null; headText: string; headType: string; tailText: string; tailType: string; type: string; [k: string]: unknown }[],
  embeddingConfig?: EmbeddingConfig,
): Promise<number> {
  // Build texts: entities first, then relationship facts
  const entityTexts = kgEntities.map((e) => buildEntityEmbeddingText(e));
  const relFactTexts = kgRelationships.map((r) => {
    // Relationship fact text: "headText headType -> type -> tailText tailType"
    return `${r.headText} (${r.headType}) -[${r.type}]-> ${r.tailText} (${r.tailType})`;
  });

  const allTexts = [...entityTexts, ...relFactTexts];
  if (allTexts.length === 0) return 0;

  const { embeddings } = await generateEmbeddings(allTexts, embeddingConfig);

  let embedded = 0;

  // Attach entity embeddings
  for (let i = 0; i < kgEntities.length; i++) {
    const emb = embeddings[i];
    if (emb) {
      kgEntities[i]!.embedding = emb;
      embedded++;
    }
  }

  // Attach relationship fact embeddings
  const relOffset = kgEntities.length;
  for (let i = 0; i < kgRelationships.length; i++) {
    const emb = embeddings[relOffset + i];
    if (emb) {
      kgRelationships[i]!.factEmbedding = emb;
      embedded++;
    }
  }

  if (embedded > 0) {
    logger.debug(`Generated ${embedded} embeddings for knowledge entities/relationships`);
  }

  return embedded;
}

// ============================================================================
// Batch text → extract → store
// ============================================================================

/**
 * Extract and store from multiple text inputs.
 *
 * @param texts - Array of text strings to process
 * @param ops   - Knowledge graph operations instance
 * @param config - Optional extraction configuration
 * @returns Array of results, one per input text
 */
export async function extractAndStoreBatch(
  texts: string[],
  ops: KnowledgeOperations,
  config: ExtractAndStoreConfig = {}
): Promise<ExtractAndStoreResult[]> {
  logger.info(`extractAndStoreBatch: ${texts.length} texts`);

  const results: ExtractAndStoreResult[] = [];

  for (const text of texts) {
    try {
      const result = await extractAndStore(text, ops, config);
      results.push(result);
    } catch (error) {
      logger.error(`Failed to extract and store text: ${(text).slice(0, 100)}...`, error);
    }
  }

  const totalEntities = results.reduce((sum, r) => sum + r.entities, 0);
  const totalRelationships = results.reduce((sum, r) => sum + r.relationships, 0);

  logger.info(
    `Batch complete: ${results.length}/${texts.length} succeeded, ${totalEntities} entities, ${totalRelationships} relationships`
  );

  return results;
}

// ============================================================================
// Conversation episodic extraction
// ============================================================================

export interface ConversationExtractionConfig extends ExtractAndStoreConfig {
  /** Number of prior episodes to include as context (default: 4) */
  contextWindow?: number;
  /** Source label for provenance tracking (e.g., 'slack-engineering') */
  source?: string;
  /** Progress callback — called after each episode is processed */
  onProgress?: (current: number, total: number) => void;
}

export interface ConversationExtractionResult {
  /** Total episodes processed */
  totalEpisodes: number;
  /** Number of episodes that produced at least one entity */
  episodesWithEntities: number;
  /** Per-episode extraction results */
  episodeResults: ExtractAndStoreResult[];
  /** Aggregate entity count across all episodes */
  entities: number;
  /** Aggregate relationship count across all episodes */
  relationships: number;
  /** Total items with embeddings generated */
  embedded: number;
  /** Total ABOUT edges created via bridge linking */
  bridgeLinked: number;
  /** Unique speakers in the conversation */
  speakers: string[];
  /** Detected format */
  format: string;
}

/**
 * Build a context string from prior episodes for context-aware extraction.
 *
 * Formats each episode as "[Speaker]: text" or just the text if no speaker.
 * Limited to `windowSize` most recent episodes before the current one.
 */
function buildEpisodeContext(
  episodes: Episode[],
  currentIndex: number,
  windowSize: number,
): string {
  const startIdx = Math.max(0, currentIndex - windowSize);
  const contextEpisodes = episodes.slice(startIdx, currentIndex);

  if (contextEpisodes.length === 0) return '';

  return contextEpisodes
    .map((ep) => {
      const prefix = ep.speaker ? `${ep.speaker}: ` : '';
      return prefix + ep.text;
    })
    .join('\n');
}

/**
 * Extract entities and relationships from a conversation using episodic processing.
 *
 * Graphiti-inspired pattern: chunk → extract with sliding context → store.
 * Each episode is processed through LLM extraction with a sliding window of
 * prior episodes as context, enabling pronoun resolution and reference tracking.
 *
 * @param chunkResult - Pre-chunked conversation (from `chunkConversation()`)
 * @param ops         - Knowledge graph operations instance
 * @param config      - Extraction and conversation configuration
 * @returns Aggregated results across all episodes
 */
export async function extractConversation(
  chunkResult: ChunkResult,
  ops: KnowledgeOperations,
  config: ConversationExtractionConfig = {},
): Promise<ConversationExtractionResult> {
  const windowSize = config.contextWindow ?? 4;
  const { episodes, format, speakers } = chunkResult;

  const result: ConversationExtractionResult = {
    totalEpisodes: episodes.length,
    episodesWithEntities: 0,
    episodeResults: [],
    entities: 0,
    relationships: 0,
    embedded: 0,
    bridgeLinked: 0,
    speakers,
    format,
  };

  if (episodes.length === 0) {
    logger.info('No episodes to process');
    return result;
  }

  logger.info(
    `Extracting conversation: ${episodes.length} episodes, ${speakers.length} speakers, ` +
    `format=${format}, contextWindow=${windowSize}`,
  );

  for (let i = 0; i < episodes.length; i++) {
    const episode = episodes[i]!;

    // Build sliding context from prior episodes
    const context = buildEpisodeContext(episodes, i, windowSize);

    // Build the episode text with speaker prefix for clarity
    const episodeText = episode.speaker
      ? `${episode.speaker}: ${episode.text}`
      : episode.text;

    try {
      // Use extractAndStore with context-aware extraction
      const epResult = await extractAndStore(episodeText, ops, {
        ...config,
        context: context || undefined,
      });

      result.episodeResults.push(epResult);
      result.entities += epResult.entities;
      result.relationships += epResult.relationships;
      if (epResult.embedded) result.embedded += epResult.embedded;
      if (epResult.bridgeLinked) result.bridgeLinked += epResult.bridgeLinked.linked;
      if (epResult.entities > 0) result.episodesWithEntities++;
    } catch (error) {
      logger.warn(
        `Failed to extract episode ${i} (${episode.speaker ?? 'unknown'}): ${error}`,
      );
    }

    // Progress callback
    config.onProgress?.(i + 1, episodes.length);
  }

  logger.info(
    `Conversation extraction complete: ${result.entities} entities, ` +
    `${result.relationships} relationships from ${result.episodesWithEntities}/${result.totalEpisodes} episodes`,
  );

  return result;
}
