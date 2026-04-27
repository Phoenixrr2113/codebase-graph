/**
 * Zod Schemas for Structured LLM Output
 *
 * Used with Vercel AI SDK `generateObject()` for type-safe, validated
 * structured output from LLMs. Replaces manual JSON regex parsing.
 *
 * Schemas:
 * - ExtractionResponseSchema: Single text entity/relationship extraction
 * - BatchExtractionResponseSchema: Multi-sample batch extraction
 * - (WS12 search schemas will be added here)
 */

import { z } from 'zod';

// ============================================================================
// Entity & Relationship Extraction
// ============================================================================

/** Single extracted entity from LLM */
export const ExtractedEntitySchema = z.object({
  /** Exact text span from the source text */
  text: z.string().describe('Exact text from the source — must match verbatim'),
  /** Entity type (e.g., Person, CodeEntity, Project) */
  type: z.string().describe('Entity type (e.g., Person, CodeEntity, Project, Decision)'),
});

/** Single extracted relationship from LLM */
export const ExtractedRelationshipSchema = z.object({
  /** Text of the head (source) entity */
  headText: z.string().describe('Text of the source entity'),
  /** Text of the tail (target) entity */
  tailText: z.string().describe('Text of the target entity'),
  /** Relationship type (e.g., CREATED, DECIDED, WORKS_ON) */
  type: z.string().describe('Relationship type (e.g., CREATED, DECIDED, WORKS_ON)'),
  /**
   * Optional ISO 8601 timestamp when this fact stops being valid.
   * Set for episodic, time-bounded facts (e.g., "meeting at 3pm tomorrow",
   * "exam on Friday", "deployment on 2026-05-01"). Null for permanent facts.
   */
  forgetAfter: z.string().nullable().optional().describe(
    'ISO 8601 timestamp when this fact expires. Set for time-bounded events; null for permanent facts.',
  ),
  /** Short phrase explaining why the fact expires (e.g., "scheduled event", "temporary assignment") */
  forgetReason: z.string().nullable().optional().describe(
    'Why this fact expires (e.g., "scheduled event", "temporary assignment"). Null for permanent facts.',
  ),
});

/** Response schema for single-text extraction (zero-shot, few-shot, context-aware) */
export const ExtractionResponseSchema = z.object({
  entities: z.array(ExtractedEntitySchema).describe('Extracted entities'),
  relationships: z.array(ExtractedRelationshipSchema).describe('Extracted relationships between entities'),
});

export type ExtractionResponse = z.infer<typeof ExtractionResponseSchema>;

/** Single sample result within a batch extraction */
export const BatchSampleResultSchema = z.object({
  sampleId: z.string().describe('The sample ID this result corresponds to'),
  entities: z.array(ExtractedEntitySchema),
  relationships: z.array(ExtractedRelationshipSchema),
});

/** Response schema for batch extraction (multiple samples in one call) */
export const BatchExtractionResponseSchema = z.object({
  results: z.array(BatchSampleResultSchema).describe('Per-sample extraction results'),
});

export type BatchExtractionResponse = z.infer<typeof BatchExtractionResponseSchema>;

