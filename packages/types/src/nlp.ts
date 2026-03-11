/**
 * @codegraph/types - Natural Language Processing types
 *
 * Guided Open Taxonomy: The LLM is given preferred types as guidance but can
 * propose new types when nothing fits. Types are strings at the boundary,
 * validated at runtime against a preferred set (not a closed union).
 *
 * Entity/relationship types are organized in two layers:
 * - Core types: universal across any knowledge domain
 * - Domain extensions: SE-specific types shipped as the default preset
 */

// ============================================================================
// Type Aliases — open strings, not closed unions
// ============================================================================

/**
 * Entity type — open string. The extractor prefers types from the preferred
 * set but may propose new ones when the conversation warrants it.
 */
export type EntityType = string;

/**
 * Relationship type — open string. Same guided-open approach as entity types.
 */
export type RelationshipType = string;

// ============================================================================
// Preferred Entity Types — guidance for the LLM, not constraints
// ============================================================================

export interface TypeDescription {
  type: string;
  description: string;
}

/**
 * Core entity types — universal across any knowledge domain.
 * These work for personal assistants, research, business, coding, etc.
 */
export const CORE_ENTITY_TYPES: TypeDescription[] = [
  { type: 'Person', description: 'People, team members, stakeholders' },
  { type: 'Organization', description: 'Companies, teams, departments, groups' },
  { type: 'Project', description: 'Codebases, repos, products, initiatives' },
  { type: 'Document', description: 'Specs, RFCs, PRDs, wiki pages, references' },
  { type: 'Decision', description: 'Choices made with rationale — "we decided to use X because Y"' },
  { type: 'Concept', description: 'Abstract ideas, domain terms, mental models' },
  { type: 'Observation', description: 'Gotchas, warnings, findings, notes — "beware of X"' },
  { type: 'Lesson', description: 'Learnings from experience — "we learned that X"' },
  { type: 'Task', description: 'Work items, action items, todos' },
  { type: 'Goal', description: 'Objectives, milestones, targets, deadlines' },
  { type: 'Constraint', description: 'Limitations, restrictions, non-functional requirements' },
  { type: 'Event', description: 'Meetings, deployments, incidents, releases, milestones' },
  { type: 'Resource', description: 'URLs, tools, environments, artifacts' },
];

/**
 * Software Engineering domain extension — default preset.
 * Added to core types when the knowledge domain is "se" (default).
 */
export const SE_ENTITY_TYPES: TypeDescription[] = [
  { type: 'Technology', description: 'Languages, frameworks, tools — "React", "Docker", "TypeScript"' },
  { type: 'Dependency', description: 'Specific packages/libraries with version context — "kuzu@0.11.3"' },
  { type: 'Service', description: 'APIs, microservices, databases, external endpoints — "Stripe API"' },
  { type: 'Pattern', description: 'Design patterns, architectural patterns — "Observer", "CQRS"' },
  { type: 'Bug', description: 'Known issues, defects, regressions' },
  { type: 'TechnicalDebt', description: 'Known shortcuts, deprecated code, migration needs' },
  { type: 'CodeEntity', description: 'Code symbol references — function names, class names, variables' },
  { type: 'Convention', description: 'Coding standards, team agreements — "always use Zod for validation"' },
  { type: 'Requirement', description: 'Features, capabilities, acceptance criteria, user stories' },
];

// ============================================================================
// Preferred Relationship Types
// ============================================================================

/**
 * Core relationship types — universal across any knowledge domain.
 */
export const CORE_RELATIONSHIP_TYPES: TypeDescription[] = [
  { type: 'RELATES_TO', description: 'Generic association (fallback when nothing else fits)' },
  { type: 'PART_OF', description: 'Composition, membership — "X is part of Y"' },
  { type: 'CONTAINS', description: 'Containment — "X contains Y"' },
  { type: 'DEPENDS_ON', description: 'Dependency — "X depends on Y"' },
  { type: 'CREATED', description: 'Authorship — "Person created X"' },
  { type: 'OWNS', description: 'Ownership, responsibility — "Person/Team owns X"' },
  { type: 'WORKS_FOR', description: 'Employment, membership — "Person works for Org"' },
  { type: 'KNOWS', description: 'Expertise, knowledge — "Person knows about X"' },
  { type: 'CAUSED_BY', description: 'Root cause — "X was caused by Y"' },
  { type: 'LED_TO', description: 'Consequence, result — "X led to Y"' },
  { type: 'BLOCKS', description: 'Impediment — "X blocks Y"' },
  { type: 'ENABLES', description: 'Makes possible — "X enables Y"' },
  { type: 'SUPERSEDES', description: 'Replacement — "X replaces Y"' },
  { type: 'DECIDED', description: 'Person/team made a choice — "Team decided X"' },
  { type: 'SUPPORTS', description: 'Evidence for — "X supports Y"' },
  { type: 'CONTRADICTS', description: 'Conflicts with — "X contradicts Y"' },
  { type: 'DOCUMENTED_IN', description: 'Recorded in — "X is documented in Y"' },
];

/**
 * Software Engineering domain extension relationships.
 */
export const SE_RELATIONSHIP_TYPES: TypeDescription[] = [
  { type: 'USES', description: 'Utilization — "Project uses React"' },
  { type: 'REQUIRES', description: 'Prerequisite — "Feature requires OAuth provider"' },
  { type: 'SOLVES', description: 'Resolution — "Pattern solves problem"' },
  { type: 'EVOLVED_FROM', description: 'Derivation — "v2 API evolved from v1"' },
  { type: 'APPLIES', description: 'Scope — "Convention applies to shared packages"' },
  { type: 'LEARNED_FROM', description: 'Insight from experience — "Lesson learned from incident"' },
];

// ============================================================================
// Domain Preset Registry
// ============================================================================

export type KnowledgeDomain = 'core' | 'se';

/**
 * Get preferred entity types for a knowledge domain.
 * Returns core types + domain extension types.
 */
export function getPreferredEntityTypes(domain: KnowledgeDomain = 'se'): TypeDescription[] {
  switch (domain) {
    case 'core':
      return [...CORE_ENTITY_TYPES];
    case 'se':
      return [...CORE_ENTITY_TYPES, ...SE_ENTITY_TYPES];
    default:
      return [...CORE_ENTITY_TYPES];
  }
}

/**
 * Get preferred relationship types for a knowledge domain.
 * Returns core types + domain extension types.
 */
export function getPreferredRelationshipTypes(domain: KnowledgeDomain = 'se'): TypeDescription[] {
  switch (domain) {
    case 'core':
      return [...CORE_RELATIONSHIP_TYPES];
    case 'se':
      return [...CORE_RELATIONSHIP_TYPES, ...SE_RELATIONSHIP_TYPES];
    default:
      return [...CORE_RELATIONSHIP_TYPES];
  }
}

// ============================================================================
// Synonym Normalization
// ============================================================================

/**
 * Maps common synonyms/variants to preferred type names.
 * Applied post-extraction to reduce type drift.
 * Keys are lowercase for case-insensitive matching.
 */
export const ENTITY_TYPE_SYNONYMS: Record<string, string> = {
  // Person variants
  'individual': 'Person',
  'user': 'Person',
  'developer': 'Person',
  'engineer': 'Person',
  'member': 'Person',
  // Organization variants
  'company': 'Organization',
  'team': 'Organization',
  'group': 'Organization',
  // Technology variants
  'framework': 'Technology',
  'language': 'Technology',
  'tool': 'Technology',
  'library': 'Dependency',
  'package': 'Dependency',
  'module': 'Dependency',
  // Bug variants
  'defect': 'Bug',
  'issue': 'Bug',
  'regression': 'Bug',
  // TechnicalDebt variants
  'techdebt': 'TechnicalDebt',
  'tech_debt': 'TechnicalDebt',
  'technical_debt': 'TechnicalDebt',
  // Decision variants
  'adr': 'Decision',
  'choice': 'Decision',
  // Convention variants
  'standard': 'Convention',
  'rule': 'Convention',
  'guideline': 'Convention',
  'best_practice': 'Convention',
  'bestpractice': 'Convention',
  // Pattern variants
  'design_pattern': 'Pattern',
  'designpattern': 'Pattern',
  'antipattern': 'Pattern',
  'anti_pattern': 'Pattern',
  // Observation variants
  'gotcha': 'Observation',
  'warning': 'Observation',
  'note': 'Observation',
  'finding': 'Observation',
  'insight': 'Observation',
  // Other mappings
  'feature': 'Requirement',
  'story': 'Requirement',
  'userstory': 'Requirement',
  'user_story': 'Requirement',
  'milestone': 'Goal',
  'objective': 'Goal',
  'api': 'Service',
  'endpoint': 'Service',
  'microservice': 'Service',
  // Legacy types from the old taxonomy → map to new equivalents
  'problem': 'Bug',
  'solution': 'Decision',
  'workflow': 'Pattern',
  'agreement': 'Decision',
  'belief': 'Observation',
  'preference': 'Convention',
  'assumption': 'Observation',
  'concern': 'Observation',
  'sentiment': 'Observation',
  'message': 'Document',
  'conversation': 'Event',
  'property': 'Concept',
  'market': 'Concept',
  'location': 'Resource',
  'metric': 'Concept',
};

export const RELATIONSHIP_TYPE_SYNONYMS: Record<string, string> = {
  // Normalize common variants
  'related_to': 'RELATES_TO',
  'related': 'RELATES_TO',
  'associated_with': 'RELATES_TO',
  'has': 'CONTAINS',
  'includes': 'CONTAINS',
  'belongs_to': 'PART_OF',
  'member_of': 'PART_OF',
  'made_by': 'CREATED',
  'authored_by': 'CREATED',
  'built_by': 'CREATED',
  'responsible_for': 'OWNS',
  'manages': 'OWNS',
  'employed_by': 'WORKS_FOR',
  'expert_in': 'KNOWS',
  'familiar_with': 'KNOWS',
  'resulted_in': 'LED_TO',
  'led_by': 'LED_TO',
  'prevents': 'BLOCKS',
  'impedes': 'BLOCKS',
  'replaces': 'SUPERSEDES',
  'deprecated_by': 'SUPERSEDES',
  'migrated_to': 'SUPERSEDES',
  'validates': 'SUPPORTS',
  'confirms': 'SUPPORTS',
  'conflicts_with': 'CONTRADICTS',
  'opposes': 'CONTRADICTS',
  'fixes': 'SOLVES',
  'resolves': 'SOLVES',
  'addresses': 'SOLVES',
  'needs': 'REQUIRES',
  'utilizes': 'USES',
  'employs': 'USES',
  'leverages': 'USES',
  'implemented_in': 'DOCUMENTED_IN',
  'recorded_in': 'DOCUMENTED_IN',
  'derived_from': 'EVOLVED_FROM',
  'based_on': 'EVOLVED_FROM',
  // Legacy relationship types → map to new equivalents
  'recommended': 'SUPPORTS',
  'sent': 'RELATES_TO',
  'received': 'RELATES_TO',
  'participated_in': 'PART_OF',
  'discussed': 'RELATES_TO',
  'assumes': 'SUPPORTS',
  'affected_by': 'CAUSED_BY',
  'follows': 'EVOLVED_FROM',
  'precedes': 'LED_TO',
  'scheduled_for': 'RELATES_TO',
  'located_at': 'PART_OF',
  'in_market': 'RELATES_TO',
  'party_to': 'PART_OF',
  'governs': 'APPLIES',
  'constrains': 'BLOCKS',
  'imposed_by': 'CAUSED_BY',
  'achieves': 'SOLVES',
  'prioritizes': 'SUPPORTS',
  'aligns_with': 'SUPPORTS',
  'consumes': 'USES',
  'feels_about': 'RELATES_TO',
  'raised': 'CREATED',
  'concerns': 'RELATES_TO',
  'triggers': 'LED_TO',
  'step_in': 'PART_OF',
  'mentioned_in': 'DOCUMENTED_IN',
  'measures': 'RELATES_TO',
  'compared_to': 'RELATES_TO',
};

/**
 * Normalize an entity type using the synonym map.
 * Returns the preferred type name if a synonym is found, otherwise
 * returns the original type with first letter capitalized (PascalCase convention).
 */
export function normalizeEntityType(type: string): string {
  const trimmed = type.trim();
  const lower = trimmed.toLowerCase();
  if (ENTITY_TYPE_SYNONYMS[lower]) {
    return ENTITY_TYPE_SYNONYMS[lower];
  }
  // PascalCase convention: capitalize first letter of each word
  return trimmed.replace(/(?:^|\s|_)\w/g, (match) => match.toUpperCase()).replace(/[\s_]/g, '');
}

/**
 * Normalize a relationship type using the synonym map.
 * Returns the preferred type name if a synonym is found, otherwise
 * returns the original type uppercased with underscores (SCREAMING_SNAKE convention).
 */
export function normalizeRelationshipType(type: string): string {
  const trimmed = type.trim();
  const lower = trimmed.toLowerCase();
  if (RELATIONSHIP_TYPE_SYNONYMS[lower]) {
    return RELATIONSHIP_TYPE_SYNONYMS[lower];
  }
  // SCREAMING_SNAKE convention
  return trimmed.toUpperCase().replace(/\s+/g, '_').replace(/-/g, '_');
}

// ============================================================================
// Annotation Types
// ============================================================================

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
