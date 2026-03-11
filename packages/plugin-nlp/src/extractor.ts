import { createOpenRouter } from '@openrouter/ai-sdk-provider';
import { generateText, type LanguageModel } from 'ai';
import { createLogger } from '@codegraph/logger';
import type {
  Sample,
  AnnotatedSample,
  EntityAnnotation,
  RelationshipAnnotation,
  TypeDescription,
  KnowledgeDomain,
} from '@codegraph/types';
import {
  getPreferredEntityTypes,
  getPreferredRelationshipTypes,
  normalizeEntityType,
  normalizeRelationshipType,
} from '@codegraph/types';

const logger = createLogger({ namespace: 'nlp:extractor' });

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
  /** Knowledge domain preset — determines which preferred types the LLM sees.
   *  Defaults to 'se' (software engineering). */
  domain: KnowledgeDomain | undefined;
};

const DEFAULT_MODEL = 'google/gemini-2.5-flash-preview';

/**
 * Format type descriptions for inclusion in LLM prompts.
 * Each type gets a short description so the LLM understands when to use it.
 */
function formatTypeList(types: TypeDescription[]): string {
  return types.map((t) => `- ${t.type}: ${t.description}`).join('\n');
}

export class EntityExtractor {
  private config: { model: string; temperature: number; domain: KnowledgeDomain };
  private model: LanguageModel;
  private entityTypes: TypeDescription[];
  private relationshipTypes: TypeDescription[];

  constructor(config: Partial<ExtractorConfig> = {}) {
    this.config = {
      model: config.model ?? DEFAULT_MODEL,
      temperature: config.temperature ?? 0.1,
      domain: config.domain ?? 'se',
    };
    this.model =
      config.languageModel ?? (getOpenRouter().chat(this.config.model) as unknown as LanguageModel);
    this.entityTypes = getPreferredEntityTypes(this.config.domain);
    this.relationshipTypes = getPreferredRelationshipTypes(this.config.domain);
    logger.debug(`EntityExtractor created with model: ${this.config.model}, domain: ${this.config.domain}`);
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

  /**
   * Context-aware extraction — extract entities only from the current text,
   * using prior messages/context to resolve pronouns and references.
   *
   * Example: if context says "Sarah: I'll refactor the payment module" and
   * current text says "Bob: She should also fix the retry logic", the extractor
   * can resolve "She" → "Sarah" from context.
   *
   * @param sample  - Sample with the CURRENT text to extract from
   * @param context - Prior messages/context for reference resolution
   * @returns AnnotatedSample with entities extracted from current text only
   */
  async extractWithContext(
    sample: Sample,
    context: string,
  ): Promise<AnnotatedSample> {
    logger.debug(`extractWithContext: sample=${sample.id}, contextLen=${context.length}`);

    const prompt = this.buildContextPrompt(sample.text, context);

    try {
      const { text } = await generateText({
        model: this.model,
        prompt,
        temperature: this.config.temperature,
      });

      logger.debug(`LLM response (context): ${text.slice(0, 500)}`);

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
      logger.error('extractWithContext failed', error);
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

  /**
   * Few-shot extraction — uses labeled examples to guide the LLM.
   * Ported from NLC's SmartLLM. Provides higher-quality extraction
   * when you have human-labeled ground truth to learn from.
   */
  async extractWithExamples(
    sample: Sample,
    examples: AnnotatedSample[]
  ): Promise<AnnotatedSample> {
    logger.debug(`extractWithExamples: sample=${sample.id}, ${examples.length} examples`);

    if (examples.length === 0) {
      // Fall back to zero-shot if no examples
      return this.extract(sample);
    }

    const prompt = this.buildFewShotPrompt(sample.text, examples);

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
      logger.error('extractWithExamples failed', error);
      throw error;
    }
  }

  private buildFewShotPrompt(text: string, examples: AnnotatedSample[]): string {
    const examplesText = examples
      .map((ex, i) => {
        const entities = ex.entities
          .map((e) => `  - [${e.type}] "${e.text}" (${e.start}-${e.end})`)
          .join('\n');

        const relationships = ex.relationships
          .map((r) => {
            const head = ex.entities.find((e) => e.id === r.headEntityId);
            const tail = ex.entities.find((e) => e.id === r.tailEntityId);
            return `  - "${head?.text}" --${r.type}--> "${tail?.text}"`;
          })
          .join('\n');

        return `### Example ${i + 1}:\nText: "${ex.text}"\nEntities:\n${entities}\nRelationships:\n${relationships}`;
      })
      .join('\n\n');

    const entityTypeList = formatTypeList(this.entityTypes);
    const relTypeList = formatTypeList(this.relationshipTypes);

    return `You are an expert at extracting structured knowledge from natural language text.

## Entity Types (prefer these, but you may propose new types if needed)
${entityTypeList}

## Relationship Types (prefer these, but you may propose new types if needed)
${relTypeList}

## Human-Labeled Examples (Ground Truth)

${examplesText}

## Your Task

Label the following text using the same format as the examples above.

### Text to Label:
"${text}"

### Output (JSON only, no explanation):
{
  "entities": [
    { "text": "<exact text from sample>", "type": "<EntityType>" }
  ],
  "relationships": [
    { "headText": "<entity text>", "tailText": "<entity text>", "type": "<RelationshipType>" }
  ]
}

Respond with valid JSON only.`;
  }

  private buildContextPrompt(text: string, context: string): string {
    const entityTypeList = formatTypeList(this.entityTypes);
    const relTypeList = formatTypeList(this.relationshipTypes);

    return `You are an expert at extracting structured knowledge from natural language text.

IMPORTANT: Extract entities and relationships ONLY from the CURRENT MESSAGE below.
Use the CONTEXT (prior messages) to resolve pronouns, references, and abbreviations,
but do NOT extract entities from the context messages themselves.

For example, if context says "Sarah: I'll handle the payment module" and the current
message says "Bob: She should also fix the retry logic", you should:
- Extract "Sarah" (resolved from "She" using context) as a Person entity
- Extract "retry logic" as a CodeEntity
- Do NOT extract "payment module" (that was in context, not current message)

## Entity Types (prefer these, but you may propose new types if needed)
${entityTypeList}

## Relationship Types (prefer these, but you may propose new types if needed)
${relTypeList}

## Context (prior messages — for reference only, do NOT extract from these):
${context}

## CURRENT MESSAGE (extract from this only):
"${text}"

## Output Format
Return a JSON object:
{
  "entities": [
    { "text": "<exact text from CURRENT MESSAGE>", "type": "<EntityType>" }
  ],
  "relationships": [
    { "headText": "<entity text>", "tailText": "<entity text>", "type": "<RelationshipType>" }
  ]
}

Extract all relevant entities and relationships from the CURRENT MESSAGE.
Use context to resolve pronouns (he/she/they/it) to actual names.
Focus on concrete entities like people, projects, decisions, goals, problems, etc.

Respond with valid JSON only, no explanation.`;
  }

  private buildPrompt(text: string): string {
    const entityTypeList = formatTypeList(this.entityTypes);
    const relTypeList = formatTypeList(this.relationshipTypes);

    return `You are an expert at extracting structured knowledge from natural language text.
Extract ALL entities and relationships from the text below.

## Entity Types (prefer these, but you may propose new types if needed)
${entityTypeList}

## Relationship Types (prefer these, but you may propose new types if needed)
${relTypeList}

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
    const entityTypeList = formatTypeList(this.entityTypes);
    const relTypeList = formatTypeList(this.relationshipTypes);

    return `You are an expert at extracting structured knowledge from natural language text.
Extract ALL entities and relationships from each sample below.

## Entity Types (prefer these, but you may propose new types if needed)
${entityTypeList}

## Relationship Types (prefer these, but you may propose new types if needed)
${relTypeList}

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
          if (start < 0) return null; // text grounding: must exist in source
          const normalizedType = normalizeEntityType(e.type);
          return {
            id: `e-${i}`,
            start,
            end: start + e.text.length,
            text: e.text,
            type: normalizedType,
            confidence: 0.9,
          };
        })
        .filter((e): e is EntityAnnotation => e !== null);

      const relationships: RelationshipAnnotation[] = (parsed.relationships ?? [])
        .map((r, i) => {
          const head = entities.find((e) => e.text === r.headText);
          const tail = entities.find((e) => e.text === r.tailText);
          if (!head || !tail) return null;
          const normalizedType = normalizeRelationshipType(r.type);
          return {
            id: `r-${i}`,
            headEntityId: head.id,
            tailEntityId: tail.id,
            type: normalizedType,
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
