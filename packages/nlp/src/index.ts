/**
 * @codegraph/nlp
 *
 * Natural language processing for entity/relationship extraction.
 * Supports auto-labeling with LLMs and importing from various sources.
 */

export {
  loadSamples,
  saveSamples,
  loadAnnotations,
  saveAnnotations,
  appendSample,
  appendAnnotation,
} from './storage';

export {
  parseClaudeExport,
  filterHumanMessages,
  filterByMinLength,
  createSample,
  createSamplesFromStrings,
  createSamplesFromJsonl,
  createSamplesFromJson,
  filterByLength,
  filterByMetadata,
} from './importers';
export type { ClaudeExport, ClaudeMessage, MessageInput } from './importers';

export {
  EntityExtractor,
  ENTITY_TYPES,
  RELATIONSHIP_TYPES,
  VALID_ENTITY_TYPES,
  VALID_RELATIONSHIP_TYPES,
} from './extractor';
export type { ExtractorConfig } from './extractor';

export { autoLabel, autoLabelFromFiles, labelSingle } from './auto-label';
export type { AutoLabelConfig } from './auto-label';

export type {
  Sample,
  AnnotatedSample,
  EntityAnnotation,
  RelationshipAnnotation,
  EntityType,
  RelationshipType,
} from '@codegraph/types';
