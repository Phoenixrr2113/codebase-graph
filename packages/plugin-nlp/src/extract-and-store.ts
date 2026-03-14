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
import type { ChunkResult, Episode, ConversationFormat } from './conversation';
import { chunkConversation } from './conversation';
import { resolveEntities, type EntityResolutionConfig } from './entity-resolution';
import { checkAndResolveConflicts, type ConflictResolutionResult } from './conflict-resolution';

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

  /** Enable temporal conflict resolution. When true, before storing new relationships,
   *  checks for existing relationships between the same entities and uses LLM to
   *  detect contradictions. Superseded edges get invalid_at set. Default: false. */
  conflictResolution?: boolean;
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
  /** Conflict resolution result (if conflictResolution was enabled) */
  conflicts?: ConflictResolutionResult;
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

  // Conflict resolution — detect and invalidate contradicted edges
  let conflictResult: ConflictResolutionResult | undefined;
  if (config.conflictResolution && kgRelationships.length > 0) {
    try {
      // Merge all per-relationship conflict results
      let totalChecked = 0;
      let totalContradictions = 0;
      let totalInvalidated = 0;
      const allDetails: ConflictResolutionResult['details'] = [];

      const crConfig: Parameters<typeof checkAndResolveConflicts>[2] = {};
      const llm = config.extractor?.languageModel;
      if (llm) crConfig.llm = llm;

      for (const rel of kgRelationships) {
        const crResult = await checkAndResolveConflicts(ops, {
          headText: rel.headText,
          headType: rel.headType,
          tailText: rel.tailText,
          tailType: rel.tailType,
          type: rel.type,
        }, crConfig);
        totalChecked += crResult.checked;
        totalContradictions += crResult.contradictions;
        totalInvalidated += crResult.invalidated;
        allDetails.push(...crResult.details);
      }

      if (totalChecked > 0) {
        conflictResult = {
          checked: totalChecked,
          contradictions: totalContradictions,
          invalidated: totalInvalidated,
          details: allDetails,
        };
        logger.info(
          `Conflict resolution: ${totalChecked} checked, ${totalContradictions} contradictions, ${totalInvalidated} invalidated`,
        );
      }
    } catch (err) {
      // Conflict resolution is non-fatal
      logger.warn(`Conflict resolution failed: ${err}`);
    }
  }

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
  if (conflictResult) storeResult.conflicts = conflictResult;
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

  // Bounded concurrency — conservative for LLM rate limits
  const BATCH_SIZE = 5;

  for (let i = 0; i < texts.length; i += BATCH_SIZE) {
    const batch = texts.slice(i, i + BATCH_SIZE);

    const settled = await Promise.allSettled(
      batch.map((text) => extractAndStore(text, ops, config)),
    );

    for (let j = 0; j < settled.length; j++) {
      const outcome = settled[j]!;
      if (outcome.status === 'fulfilled') {
        results.push(outcome.value);
      } else {
        const text = batch[j]!;
        logger.error(`Failed to extract and store text: ${text.slice(0, 100)}...`, outcome.reason);
      }
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

// ============================================================================
// Full ingestion pipeline: text → chunk → extract → resolve → store
// ============================================================================

export interface IngestConversationConfig {
  /** Conversation format (default: 'auto' — auto-detect).
   *  Accepts string for MCP compatibility; validated at runtime. */
  format?: string;
  /** Source label for provenance tracking (e.g., 'slack-engineering') */
  source?: string;
  /** LLM model override for extraction */
  model?: string;
  /** Number of prior episodes to include as context (default: 4) */
  contextWindow?: number;
  /** Entity resolution config — omit to skip resolution */
  entityResolution?: Partial<EntityResolutionConfig>;
  /** Whether to run entity resolution after extraction (default: true) */
  resolve?: boolean;
  /** Direct extractor config override (e.g., for injecting a mock languageModel in tests) */
  extractor?: Partial<ExtractorConfig>;
  /** Enable temporal conflict resolution (default: false) */
  conflictResolution?: boolean;
}

export interface IngestConversationResult {
  /** Total episodes processed */
  totalEpisodes: number;
  /** Number of episodes that produced at least one entity */
  episodesWithEntities: number;
  /** Total entities stored across all episodes */
  entities: number;
  /** Total relationships stored */
  relationships: number;
  /** Total items with embeddings generated */
  embedded: number;
  /** Unique speakers detected in the conversation */
  speakers: string[];
  /** Detected or specified format */
  format: string;
  /** Entity resolution stats (if resolution was run) */
  resolution?: {
    merged: number;
    kept: number;
  };
}

/**
 * Full conversation ingestion pipeline.
 *
 * Accepts raw conversation text and runs the complete pipeline:
 * 1. Chunk into episodes (auto-detect format or use specified format)
 * 2. Extract entities/relationships per episode with sliding context
 * 3. Store in knowledge graph with embeddings
 * 4. (Optional) Run entity resolution to merge cross-episode duplicates
 *
 * This is the top-level entry point called by the MCP `ingest_conversation` tool.
 *
 * @param text   - Raw conversation text (multi-turn)
 * @param ops    - Knowledge graph operations instance
 * @param config - Ingestion configuration
 * @returns Aggregated results
 */
export async function ingestConversation(
  text: string,
  ops: KnowledgeOperations,
  config: IngestConversationConfig = {},
): Promise<IngestConversationResult> {
  const shouldResolve = config.resolve ?? true;

  logger.info(`ingestConversation: textLen=${text.length}, format=${config.format ?? 'auto'}, source=${config.source ?? 'none'}`);

  // Step 1: Chunk the conversation into episodes
  const validFormats = new Set(['chat', 'timestamped', 'paragraphs', 'auto']);
  const format = (validFormats.has(config.format ?? '') ? config.format : 'auto') as ConversationFormat;
  const chunkResult = chunkConversation(text, { format });

  logger.info(
    `Chunked into ${chunkResult.episodes.length} episodes, format=${chunkResult.format}, speakers=${chunkResult.speakers.join(',')}`,
  );

  if (chunkResult.episodes.length === 0) {
    return {
      totalEpisodes: 0,
      episodesWithEntities: 0,
      entities: 0,
      relationships: 0,
      embedded: 0,
      speakers: [],
      format: chunkResult.format,
    };
  }

  // Step 2: Extract entities/relationships per episode with sliding context
  const extractionConfig: ConversationExtractionConfig = {
    contextWindow: config.contextWindow ?? 4,
  };
  if (config.source) extractionConfig.source = config.source;
  if (config.extractor) {
    // Direct extractor config (e.g., from tests injecting a mock languageModel)
    extractionConfig.extractor = config.extractor;
  } else if (config.model) {
    extractionConfig.extractor = { model: config.model };
  }
  if (config.conflictResolution) {
    extractionConfig.conflictResolution = true;
  }

  const extractResult = await extractConversation(chunkResult, ops, extractionConfig);

  const result: IngestConversationResult = {
    totalEpisodes: extractResult.totalEpisodes,
    episodesWithEntities: extractResult.episodesWithEntities,
    entities: extractResult.entities,
    relationships: extractResult.relationships,
    embedded: extractResult.embedded,
    speakers: extractResult.speakers,
    format: extractResult.format,
  };

  // Step 3: Entity resolution — merge cross-episode duplicates
  if (shouldResolve && extractResult.entities > 1) {
    try {
      const resolutionResult = await resolveEntities(ops, config.entityResolution);
      result.resolution = {
        merged: resolutionResult.merges.length,
        kept: resolutionResult.kept,
      };
      logger.info(
        `Entity resolution: ${resolutionResult.merges.length} merges, ${resolutionResult.kept} kept`,
      );
    } catch (err) {
      // Entity resolution is non-fatal — entities are still stored
      logger.warn(`Entity resolution failed: ${err}`);
    }
  }

  return result;
}
