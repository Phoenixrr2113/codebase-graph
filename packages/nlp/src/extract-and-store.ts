/**
 * Extract-and-Store bridge
 *
 * Connects the NLP extraction layer (@codegraph/nlp) with the knowledge graph
 * storage layer (@codegraph/graph). Extracts entities and relationships from
 * natural language text, then stores them in the Kuzu knowledge graph.
 *
 * Two modes:
 * 1. Zero-shot: Uses EntityExtractor.extract() — no examples needed
 * 2. Few-shot:  Uses EntityExtractor.extractWithExamples() — learns from labeled examples
 */

import { createLogger } from '@codegraph/logger';
import type { Sample, AnnotatedSample } from '@codegraph/types';
import type { KnowledgeOperations } from '@codegraph/graph';
import { EntityExtractor, type ExtractorConfig } from './extractor';

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

  // Extract using few-shot or zero-shot mode
  const annotated = config.examples && config.examples.length > 0
    ? await extractor.extractWithExamples(sample, config.examples)
    : await extractor.extract(sample);

  // Filter by confidence threshold
  const entities = annotated.entities.filter((e) => e.confidence >= minConfidence);
  const relationships = annotated.relationships.filter((r) => r.confidence >= minConfidence);

  logger.debug(
    `Extracted ${entities.length} entities, ${relationships.length} relationships (threshold: ${minConfidence})`
  );

  // Store in knowledge graph via importEntitiesAndRelationships
  const kgEntities = entities.map((e) => ({
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

  const result = await ops.importEntitiesAndRelationships(kgEntities, kgRelationships, sampleId);

  logger.info(
    `Stored ${result.entities} entities, ${result.relationships} relationships (sampleId: ${sampleId})`
  );

  return {
    entities: result.entities,
    relationships: result.relationships,
    sampleId,
    annotated,
  };
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
