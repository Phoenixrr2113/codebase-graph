/**
 * @codegraph/types - Natural Language Processing types
 * Types for entity/relationship extraction from natural language text.
 */

export type EntityType =
  | 'Person'
  | 'Project'
  | 'Task'
  | 'Decision'
  | 'Event'
  | 'Document'
  | 'Property'
  | 'Concept'
  | 'Belief'
  | 'Goal'
  | 'Preference'
  | 'Problem'
  | 'Solution'
  | 'Workflow'
  | 'Agreement'
  | 'Constraint'
  | 'Resource'
  | 'Metric'
  | 'Message'
  | 'Conversation'
  | 'Location'
  | 'Market'
  | 'Sentiment'
  | 'Concern'
  | 'Lesson'
  | 'Assumption'
  | 'Organization'
  | 'CodeEntity';

export type RelationshipType =
  | 'OWNS'
  | 'CREATED'
  | 'PART_OF'
  | 'CONTAINS'
  | 'KNOWS'
  | 'WORKS_FOR'
  | 'RECOMMENDED'
  | 'SENT'
  | 'RECEIVED'
  | 'PARTICIPATED_IN'
  | 'DISCUSSED'
  | 'DECIDED'
  | 'LED_TO'
  | 'SUPPORTS'
  | 'CONTRADICTS'
  | 'ASSUMES'
  | 'SOLVES'
  | 'CAUSED_BY'
  | 'AFFECTED_BY'
  | 'DEPENDS_ON'
  | 'BLOCKS'
  | 'ENABLES'
  | 'FOLLOWS'
  | 'PRECEDES'
  | 'SCHEDULED_FOR'
  | 'EVOLVED_FROM'
  | 'SUPERSEDES'
  | 'LEARNED_FROM'
  | 'LOCATED_AT'
  | 'IN_MARKET'
  | 'PARTY_TO'
  | 'GOVERNS'
  | 'DOCUMENTED_IN'
  | 'CONSTRAINS'
  | 'IMPOSED_BY'
  | 'ACHIEVES'
  | 'PRIORITIZES'
  | 'ALIGNS_WITH'
  | 'REQUIRES'
  | 'CONSUMES'
  | 'FEELS_ABOUT'
  | 'RAISED'
  | 'CONCERNS'
  | 'TRIGGERS'
  | 'STEP_IN'
  | 'RELATED_TO'
  | 'APPLIES'
  | 'MENTIONED_IN'
  | 'MEASURES'
  | 'COMPARED_TO';

export type EntityAnnotation = {
  id: string;
  start: number;
  end: number;
  text: string;
  type: EntityType;
  confidence: number;
};

export type RelationshipAnnotation = {
  id: string;
  headEntityId: string;
  tailEntityId: string;
  type: RelationshipType;
  confidence: number;
};

export type Sample = {
  id: string;
  text: string;
  source?: string;
  sourceFile?: string;
  context?: string;
  metadata?: Record<string, unknown>;
  timestamp?: string;
  createdAt?: string;
};

export type AnnotatedSample = Sample & {
  entities: EntityAnnotation[];
  relationships: RelationshipAnnotation[];
  annotatedBy: 'human' | 'auto';
  annotatedAt: string;
  modelVersion?: string;
};
