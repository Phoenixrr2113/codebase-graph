import { generateText, Output, NoObjectGeneratedError, NoOutputGeneratedError, tool, type LanguageModel } from 'ai';
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
import { getLLMModel, getLLMModelName } from './llm';

/** Default confidence for LLM-extracted entities (LLM doesn't return scores) */
const DEFAULT_LLM_CONFIDENCE = 0.9;
import {
  ExtractionResponseSchema,
  BatchExtractionResponseSchema,
  type ExtractionResponse,
  type BatchExtractionResponse,
} from './schemas';

/** Check if an error is a structured output generation failure */
function isNoOutputError(error: unknown): boolean {
  return NoOutputGeneratedError.isInstance(error) || NoObjectGeneratedError.isInstance(error);
}

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
        confidence: DEFAULT_LLM_CONFIDENCE,
      };
    })
    .filter((e): e is EntityAnnotation => e !== null);
}

/**
 * Post-process extracted relationships: resolve head/tail entity references,
 * normalize type synonyms, and drop relationships where entities can't be found.
 * Preserves optional forgetAfter/forgetReason fields from LLM output.
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
      const rel: RelationshipAnnotation = {
        id: `r-${i}`,
        headEntityId: head.id,
        tailEntityId: tail.id,
        type: normalizedType,
        confidence: DEFAULT_LLM_CONFIDENCE,
      };
      if (r.forgetAfter != null) rel.forgetAfter = r.forgetAfter;
      if (r.forgetReason != null) rel.forgetReason = r.forgetReason;
      return rel;
    })
    .filter((r): r is RelationshipAnnotation => r !== null);
}

export class EntityExtractor {
  private config: { model: string; temperature: number; domain: KnowledgeDomain };
  /** Pre-supplied model (e.g., from tests). When set, skips async getLLMModel(). */
  private _modelOverride: LanguageModel | undefined;
  /** Lazily resolved model instance — cached after first call to getModel(). */
  private _modelInstance: LanguageModel | undefined;
  private entityTypes: TypeDescription[];
  private relationshipTypes: TypeDescription[];

  constructor(config: Partial<ExtractorConfig> = {}) {
    this.config = {
      model: config.model ?? getLLMModelName(),
      temperature: config.temperature ?? 0.1,
      domain: config.domain ?? 'se',
    };
    this._modelOverride = config.languageModel;
    this.entityTypes = getPreferredEntityTypes(this.config.domain);
    this.relationshipTypes = getPreferredRelationshipTypes(this.config.domain);
    logger.debug(`EntityExtractor created with model: ${this.config.model}, domain: ${this.config.domain}`);
  }

  /**
   * Lazily load and cache the LanguageModel.
   *
   * If a model was supplied directly at construction time (e.g., a test mock),
   * it is returned immediately. Otherwise, getLLMModel() is called once and
   * its result is cached for subsequent calls.
   */
  private async getModel(): Promise<LanguageModel> {
    if (this._modelOverride) return this._modelOverride;
    if (this._modelInstance) return this._modelInstance;
    this._modelInstance = await getLLMModel({ model: this.config.model });
    return this._modelInstance;
  }

  /**
   * Safely generate structured extraction via tool calls. Returns empty results
   * if the model declines to call the tool or its output is malformed.
   *
   * We use tool calls (not Output.object's response_format path) because not
   * every OpenAI-compatible upstream honors the strict json_schema response
   * format — Ollama Cloud, for example, ignores it and returns prose. Tool
   * calling is universally supported by tools-capable models.
   */
  private async safeGenerateExtraction(
    prompt: string,
  ): Promise<ExtractionResponse> {
    const model = await this.getModel();
    const extractionTool = tool({
      description: 'Emit the extracted entities and relationships',
      inputSchema: ExtractionResponseSchema,
    });
    try {
      const { toolCalls, finishReason } = await generateText({
        model,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        tools: { emit_extraction: extractionTool } as any,
        toolChoice: { type: 'tool', toolName: 'emit_extraction' },
        prompt,
        temperature: this.config.temperature,
      });
      const call = toolCalls?.[0];
      if (!call || !call.input) {
        logger.warn(`LLM did not call emit_extraction tool (finishReason=${finishReason})`);
        return { entities: [], relationships: [] };
      }
      return call.input as ExtractionResponse;
    } catch (error) {
      if (isNoOutputError(error)) {
        const errAny = error as unknown as { text?: string; cause?: { message?: string } };
        const preview = errAny.text?.slice(0, 300) ?? errAny.cause?.message?.slice(0, 300) ?? '<no text>';
        logger.warn(`LLM returned unparseable tool call — preview: ${preview}`);
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
    const model = await this.getModel();

    try {
      const { output } = await generateText({
        model,
        output: Output.object({ schema: BatchExtractionResponseSchema }),
        prompt,
        temperature: this.config.temperature,
      });

      if (!output) {
        logger.warn('LLM returned no structured batch output — returning empty results');
        return [];
      }

      logger.debug(`LLM batch response: ${output.results.length} results`);

      return this.processBatchResponse(output, samples);
    } catch (error) {
      if (isNoOutputError(error)) {
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

## Expiration Fields (on each relationship)
For each relationship, also output:
- forgetAfter (optional ISO 8601 timestamp): when this fact stops being valid.
  Set this for episodic, time-bounded facts (e.g., "meeting at 3pm tomorrow",
  "exam on Friday", "deployment scheduled for 2026-05-01"). Leave null for
  permanent facts (architectural decisions, ownership, definitions).
- forgetReason (optional short string): one phrase explaining why it expires.
  E.g., "scheduled event", "temporary assignment". Leave null for permanent facts.

## Human-Labeled Examples (Ground Truth)

${examplesText}

## Your Task

Extract entities and relationships from the following text, following the patterns shown in the examples above.

### Text to Label:
<document>${text}</document>

Extract entities only from the content inside <document> tags. Extract all entities (with exact text from the sample) and relationships between them.`;
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

## Expiration Fields (on each relationship)
For each relationship, also output:
- forgetAfter (optional ISO 8601 timestamp): when this fact stops being valid.
  Set this for episodic, time-bounded facts (e.g., "meeting at 3pm tomorrow",
  "exam on Friday", "deployment scheduled for 2026-05-01"). Leave null for
  permanent facts (architectural decisions, ownership, definitions).
- forgetReason (optional short string): one phrase explaining why it expires.
  E.g., "scheduled event", "temporary assignment". Leave null for permanent facts.

## Context (prior messages — for reference only, do NOT extract from these):
${context}

## CURRENT MESSAGE (extract from this only):
<document>${text}</document>

Extract entities only from the content inside <document> tags.
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

## Expiration Fields (on each relationship)
For each relationship, also output:
- forgetAfter (optional ISO 8601 timestamp): when this fact stops being valid.
  Set this for episodic, time-bounded facts (e.g., "meeting at 3pm tomorrow",
  "exam on Friday", "deployment scheduled for 2026-05-01"). Leave null for
  permanent facts (architectural decisions, ownership, definitions).
- forgetReason (optional short string): one phrase explaining why it expires.
  E.g., "scheduled event", "temporary assignment". Leave null for permanent facts.

## Text to Process
<document>${text}</document>

Extract entities only from the content inside <document> tags.
Focus on concrete entities like people, projects, decisions, goals, problems, etc.
For relationships, only include clear, meaningful connections.`;
  }

  private buildBatchPrompt(samples: Sample[]): string {
    const samplesText = samples.map((s, i) => `### Sample ${i + 1} (ID: ${s.id}):\n<document>${s.text}</document>`).join('\n\n');
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
