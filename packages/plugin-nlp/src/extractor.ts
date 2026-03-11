import { generateObject, NoObjectGeneratedError, type LanguageModel } from 'ai';
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
import { getLLMModelSync, getLLMModelName } from './llm';
import {
  ExtractionResponseSchema,
  BatchExtractionResponseSchema,
  type ExtractionResponse,
  type BatchExtractionResponse,
} from './schemas';

const logger = createLogger({ namespace: 'nlp:extractor' });

export type ExtractorConfig = {
  model: string | undefined;
  temperature: number | undefined;
  languageModel: LanguageModel | undefined;
  /** Knowledge domain preset — determines which preferred types the LLM sees.
   *  Defaults to 'se' (software engineering). */
  domain: KnowledgeDomain | undefined;
};

/**
 * Format type descriptions for inclusion in LLM prompts.
 * Each type gets a short description so the LLM understands when to use it.
 */
function formatTypeList(types: TypeDescription[]): string {
  return types.map((t) => `- ${t.type}: ${t.description}`).join('\n');
}

/**
 * Post-process extracted entities: ground them in the source text, compute
 * character offsets, and normalize type synonyms.
 *
 * Entities whose text is not found in the source are silently dropped
 * (text grounding requirement).
 */
function groundEntities(
  raw: ExtractionResponse['entities'],
  sampleText: string,
): EntityAnnotation[] {
  return raw
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
}

/**
 * Post-process extracted relationships: resolve head/tail entity references,
 * normalize type synonyms, and drop relationships where entities can't be found.
 */
function resolveRelationships(
  raw: ExtractionResponse['relationships'],
  entities: EntityAnnotation[],
): RelationshipAnnotation[] {
  return raw
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
}

export class EntityExtractor {
  private config: { model: string; temperature: number; domain: KnowledgeDomain };
  private model: LanguageModel;
  private entityTypes: TypeDescription[];
  private relationshipTypes: TypeDescription[];

  constructor(config: Partial<ExtractorConfig> = {}) {
    this.config = {
      model: config.model ?? getLLMModelName(),
      temperature: config.temperature ?? 0.1,
      domain: config.domain ?? 'se',
    };
    this.model =
      config.languageModel ?? getLLMModelSync({ model: this.config.model });
    this.entityTypes = getPreferredEntityTypes(this.config.domain);
    this.relationshipTypes = getPreferredRelationshipTypes(this.config.domain);
    logger.debug(`EntityExtractor created with model: ${this.config.model}, domain: ${this.config.domain}`);
  }

  /**
   * Safely call generateObject, returning empty results on parse failures.
   * This handles cases where the LLM returns non-JSON or malformed output.
   */
  private async safeGenerateExtraction(
    prompt: string,
  ): Promise<ExtractionResponse> {
    try {
      const { object } = await generateObject({
        model: this.model,
        schema: ExtractionResponseSchema,
        prompt,
        temperature: this.config.temperature,
      });
      return object;
    } catch (error) {
      if (NoObjectGeneratedError.isInstance(error)) {
        logger.warn(`LLM returned unparseable response — returning empty result`);
        return { entities: [], relationships: [] };
      }
      throw error;
    }
  }

  async extract(sample: Sample): Promise<AnnotatedSample> {
    logger.debug(`extract: sample=${sample.id}`);

    const prompt = this.buildPrompt(sample.text);

    try {
      const object = await this.safeGenerateExtraction(prompt);

      logger.debug(`LLM structured response: ${object.entities.length} entities, ${object.relationships.length} relationships`);

      const entities = groundEntities(object.entities, sample.text);
      const relationships = resolveRelationships(object.relationships, entities);

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
      const object = await this.safeGenerateExtraction(prompt);

      logger.debug(`LLM structured response (context): ${object.entities.length} entities, ${object.relationships.length} relationships`);

      const entities = groundEntities(object.entities, sample.text);
      const relationships = resolveRelationships(object.relationships, entities);

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
      const { object } = await generateObject({
        model: this.model,
        schema: BatchExtractionResponseSchema,
        prompt,
        temperature: this.config.temperature,
      });

      logger.debug(`LLM batch response: ${object.results.length} results`);

      return this.processBatchResponse(object, samples);
    } catch (error) {
      if (NoObjectGeneratedError.isInstance(error)) {
        logger.warn('LLM returned unparseable batch response — returning empty results');
        return [];
      }
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
      const object = await this.safeGenerateExtraction(prompt);

      logger.debug(`LLM structured response (few-shot): ${object.entities.length} entities, ${object.relationships.length} relationships`);

      const entities = groundEntities(object.entities, sample.text);
      const relationships = resolveRelationships(object.relationships, entities);

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

Extract entities and relationships from the following text, following the patterns shown in the examples above.

### Text to Label:
"${text}"

Extract all entities (with exact text from the sample) and relationships between them.`;
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

Extract all relevant entities and relationships from the CURRENT MESSAGE.
Use context to resolve pronouns (he/she/they/it) to actual names.
Focus on concrete entities like people, projects, decisions, goals, problems, etc.`;
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

Extract as many relevant entities and relationships as possible.
Focus on concrete entities like people, projects, decisions, goals, problems, etc.
For relationships, only include clear, meaningful connections.`;
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

Extract as many relevant entities and relationships as possible from EACH sample.
Focus on concrete entities like people, projects, decisions, goals, problems, etc.
For relationships, only include clear, meaningful connections.`;
  }

  /**
   * Process structured batch response: ground entities, resolve relationships,
   * and build AnnotatedSample results.
   */
  private processBatchResponse(
    response: BatchExtractionResponse,
    samples: Sample[],
  ): AnnotatedSample[] {
    const results: AnnotatedSample[] = [];

    for (const result of response.results) {
      const sample = samples.find((s) => s.id === result.sampleId);
      if (!sample) continue;

      const entities = groundEntities(result.entities, sample.text);
      const relationships = resolveRelationships(result.relationships, entities);

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
  }
}
