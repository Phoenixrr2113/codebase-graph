import { createOpenRouter } from '@openrouter/ai-sdk-provider';
import { generateText, type LanguageModel } from 'ai';
import { createLogger } from '@codegraph/logger';
import type {
  Sample,
  AnnotatedSample,
  EntityAnnotation,
  RelationshipAnnotation,
  EntityType,
  RelationshipType,
} from '@codegraph/types';

const logger = createLogger({ namespace: 'nlp:extractor' });

const ENTITY_TYPES: EntityType[] = [
  'Person',
  'Project',
  'Task',
  'Decision',
  'Event',
  'Document',
  'Property',
  'Concept',
  'Belief',
  'Goal',
  'Preference',
  'Problem',
  'Solution',
  'Workflow',
  'Agreement',
  'Constraint',
  'Resource',
  'Metric',
  'Message',
  'Conversation',
  'Location',
  'Market',
  'Sentiment',
  'Concern',
  'Lesson',
  'Assumption',
  'Organization',
  'CodeEntity',
];

const RELATIONSHIP_TYPES: RelationshipType[] = [
  'OWNS',
  'CREATED',
  'PART_OF',
  'CONTAINS',
  'KNOWS',
  'WORKS_FOR',
  'RECOMMENDED',
  'SENT',
  'RECEIVED',
  'PARTICIPATED_IN',
  'DISCUSSED',
  'DECIDED',
  'LED_TO',
  'SUPPORTS',
  'CONTRADICTS',
  'ASSUMES',
  'SOLVES',
  'CAUSED_BY',
  'AFFECTED_BY',
  'DEPENDS_ON',
  'BLOCKS',
  'ENABLES',
  'FOLLOWS',
  'PRECEDES',
  'SCHEDULED_FOR',
  'EVOLVED_FROM',
  'SUPERSEDES',
  'LEARNED_FROM',
  'LOCATED_AT',
  'IN_MARKET',
  'PARTY_TO',
  'GOVERNS',
  'DOCUMENTED_IN',
  'CONSTRAINS',
  'IMPOSED_BY',
  'ACHIEVES',
  'PRIORITIZES',
  'ALIGNS_WITH',
  'REQUIRES',
  'CONSUMES',
  'FEELS_ABOUT',
  'RAISED',
  'CONCERNS',
  'TRIGGERS',
  'STEP_IN',
  'RELATED_TO',
  'APPLIES',
  'MENTIONED_IN',
  'MEASURES',
  'COMPARED_TO',
];

const VALID_ENTITY_TYPES = new Set<string>(ENTITY_TYPES);
const VALID_RELATIONSHIP_TYPES = new Set<string>(RELATIONSHIP_TYPES);

let _openrouter: ReturnType<typeof createOpenRouter> | null = null;

function getOpenRouter() {
  if (!_openrouter) {
    _openrouter = createOpenRouter();
  }
  return _openrouter;
}

export type ExtractorConfig = {
  model: string | undefined;
  temperature: number | undefined;
  languageModel: LanguageModel | undefined;
};

const DEFAULT_MODEL = 'google/gemini-2.0-flash-001';

export class EntityExtractor {
  private config: { model: string; temperature: number };
  private model: LanguageModel;

  constructor(config: Partial<ExtractorConfig> = {}) {
    this.config = {
      model: config.model ?? DEFAULT_MODEL,
      temperature: config.temperature ?? 0.1,
    };
    this.model =
      config.languageModel ?? (getOpenRouter().chat(this.config.model) as unknown as LanguageModel);
    logger.debug(`EntityExtractor created with model: ${this.config.model}`);
  }

  async extract(sample: Sample): Promise<AnnotatedSample> {
    logger.debug(`extract: sample=${sample.id}`);

    const prompt = this.buildPrompt(sample.text);

    try {
      const { text } = await generateText({
        model: this.model,
        prompt,
        temperature: this.config.temperature,
      });

      logger.debug(`LLM response: ${text.slice(0, 500)}`);

      const { entities, relationships } = this.parseResponse(text, sample.text);

      return {
        ...sample,
        entities,
        relationships,
        annotatedBy: 'auto',
        annotatedAt: new Date().toISOString(),
        modelVersion: this.config.model,
      };
    } catch (error) {
      logger.error('extract failed', error);
      throw error;
    }
  }

  async extractBatch(samples: Sample[]): Promise<AnnotatedSample[]> {
    logger.debug(`extractBatch: ${samples.length} samples`);

    const prompt = this.buildBatchPrompt(samples);

    try {
      const { text } = await generateText({
        model: this.model,
        prompt,
        temperature: this.config.temperature,
      });

      logger.debug(`LLM response: ${text.slice(0, 500)}`);

      return this.parseBatchResponse(text, samples);
    } catch (error) {
      logger.error('extractBatch failed', error);
      throw error;
    }
  }

  private buildPrompt(text: string): string {
    return `You are an expert at extracting structured knowledge from natural language text.
Extract ALL entities and relationships from the text below.

## Entity Types
${ENTITY_TYPES.join(', ')}

## Relationship Types
${RELATIONSHIP_TYPES.join(', ')}

## Text to Process
"${text}"

## Output Format
Return a JSON object:
{
  "entities": [
    { "text": "<exact text from sample>", "type": "<EntityType>" }
  ],
  "relationships": [
    { "headText": "<entity text>", "tailText": "<entity text>", "type": "<RelationshipType>" }
  ]
}

Extract as many relevant entities and relationships as possible.
Focus on concrete entities like people, projects, decisions, goals, problems, etc.
For relationships, only include clear, meaningful connections.

Respond with valid JSON only, no explanation.`;
  }

  private buildBatchPrompt(samples: Sample[]): string {
    const samplesText = samples.map((s, i) => `### Sample ${i + 1} (ID: ${s.id}):\n"${s.text}"`).join('\n\n');

    return `You are an expert at extracting structured knowledge from natural language text.
Extract ALL entities and relationships from each sample below.

## Entity Types
${ENTITY_TYPES.join(', ')}

## Relationship Types
${RELATIONSHIP_TYPES.join(', ')}

## Samples to Process (${samples.length} total)

${samplesText}

## Output Format
Return a JSON object with results for each sample:
{
  "results": [
    {
      "sampleId": "<sample id>",
      "entities": [
        { "text": "<exact text from sample>", "type": "<EntityType>" }
      ],
      "relationships": [
        { "headText": "<entity text>", "tailText": "<entity text>", "type": "<RelationshipType>" }
      ]
    }
  ]
}

Extract as many relevant entities and relationships as possible.
Focus on concrete entities like people, projects, decisions, goals, problems, etc.
For relationships, only include clear, meaningful connections.

Respond with valid JSON only, no explanation.`;
  }

  private parseResponse(
    text: string,
    sampleText: string
  ): { entities: EntityAnnotation[]; relationships: RelationshipAnnotation[] } {
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      logger.warn(`No JSON found in response: ${text.slice(0, 200)}`);
      return { entities: [], relationships: [] };
    }

    try {
      const parsed = JSON.parse(jsonMatch[0]) as {
        entities?: Array<{ text: string; type: string }>;
        relationships?: Array<{ headText: string; tailText: string; type: string }>;
      };

      const entities: EntityAnnotation[] = (parsed.entities ?? [])
        .map((e, i) => {
          const start = sampleText.indexOf(e.text);
          if (start < 0) return null;
          if (!VALID_ENTITY_TYPES.has(e.type)) {
            logger.warn(`Invalid entity type: ${e.type}, skipping`);
            return null;
          }
          return {
            id: `e-${i}`,
            start,
            end: start + e.text.length,
            text: e.text,
            type: e.type as EntityType,
            confidence: 0.9,
          };
        })
        .filter((e): e is EntityAnnotation => e !== null);

      const relationships: RelationshipAnnotation[] = (parsed.relationships ?? [])
        .map((r, i) => {
          const head = entities.find((e) => e.text === r.headText);
          const tail = entities.find((e) => e.text === r.tailText);
          if (!head || !tail) return null;
          if (!VALID_RELATIONSHIP_TYPES.has(r.type)) {
            logger.warn(`Invalid relationship type: ${r.type}, skipping`);
            return null;
          }
          return {
            id: `r-${i}`,
            headEntityId: head.id,
            tailEntityId: tail.id,
            type: r.type as RelationshipType,
            confidence: 0.9,
          };
        })
        .filter((r): r is RelationshipAnnotation => r !== null);

      return { entities, relationships };
    } catch (error) {
      logger.error(`Failed to parse response: ${text.slice(0, 200)}`, error);
      return { entities: [], relationships: [] };
    }
  }

  private parseBatchResponse(text: string, samples: Sample[]): AnnotatedSample[] {
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      logger.warn(`No JSON found in response: ${text.slice(0, 500)}`);
      return [];
    }

    try {
      const parsed = JSON.parse(jsonMatch[0]) as {
        results?: Array<{
          sampleId: string;
          entities?: Array<{ text: string; type: string }>;
          relationships?: Array<{ headText: string; tailText: string; type: string }>;
        }>;
      };

      const results: AnnotatedSample[] = [];

      for (const result of parsed.results ?? []) {
        const sample = samples.find((s) => s.id === result.sampleId);
        if (!sample) continue;

        const { entities, relationships } = this.parseResponse(
          JSON.stringify({ entities: result.entities, relationships: result.relationships }),
          sample.text
        );

        results.push({
          ...sample,
          entities,
          relationships,
          annotatedBy: 'auto',
          annotatedAt: new Date().toISOString(),
          modelVersion: this.config.model,
        });
      }

      return results;
    } catch (error) {
      logger.error(`Failed to parse batch response: ${text.slice(0, 500)}`, error);
      return [];
    }
  }
}

export { ENTITY_TYPES, RELATIONSHIP_TYPES, VALID_ENTITY_TYPES, VALID_RELATIONSHIP_TYPES };
