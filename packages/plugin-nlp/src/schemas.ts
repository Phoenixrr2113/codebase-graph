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

// ============================================================================
// WS12 Search Schemas (placeholders — implemented in WS11.3)
// ============================================================================

/** GRAPH_ANSWER: LLM-generated answer from graph context */
export const GraphAnswerSchema = z.object({
  answer: z.string().describe('Natural language answer to the question'),
  confidence: z.number().min(0).max(1).describe('Confidence in the answer (0-1)'),
  sources: z.array(z.object({
    nodeType: z.string().describe('Type of the source node (e.g., Function, Class, Entity)'),
    name: z.string().describe('Name of the source node'),
    relevance: z.string().describe('Brief explanation of why this source is relevant'),
  })).describe('Source nodes that informed the answer'),
});

export type GraphAnswer = z.infer<typeof GraphAnswerSchema>;

/** NL_TO_CYPHER: Natural language → Cypher query translation */
export const NLToCypherSchema = z.object({
  cypher: z.string().describe('Valid Cypher query for FalkorDB'),
  explanation: z.string().describe('Brief explanation of what the query does'),
  parametersJson: z.string().optional().describe('JSON object of query parameters, e.g. {"name": "auth"} — omit if no parameters needed'),
});

export type NLToCypher = z.infer<typeof NLToCypherSchema>;

/** SMART_SEARCH: Route classification for intelligent search dispatch */
export const SearchRouteSchema = z.object({
  strategy: z.enum(['VECTOR', 'HYBRID', 'GRAPH_ANSWER', 'NL_TO_CYPHER', 'CONTEXT_WALK'])
    .describe('The best search strategy for this query'),
  reasoning: z.string().describe('Brief explanation for why this strategy was chosen'),
  rewrittenQuery: z.string().optional().describe('Optionally rewritten query for better results'),
});

export type SearchRoute = z.infer<typeof SearchRouteSchema>;

/** CONTEXT_WALK: Next step in iterative graph exploration */
export const ContextWalkStepSchema = z.object({
  action: z.enum(['expand', 'answer', 'refine']).describe('What to do next'),
  /** For "expand": which node/direction to explore next */
  expandTarget: z.string().optional().describe('Node name or pattern to expand'),
  /** For "answer": the synthesized answer */
  answer: z.string().optional().describe('Synthesized answer from collected context'),
  /** For "refine": how to adjust the search */
  refinedQuery: z.string().optional().describe('Refined search query'),
  reasoning: z.string().describe('Explanation of the decision'),
  /** 0-1 confidence that the currently collected context is sufficient to answer */
  confidence: z.number().min(0).max(1).optional().describe(
    'Your confidence (0-1) that you have enough context to answer. 0.8+ means very confident.',
  ),
});

export type ContextWalkStep = z.infer<typeof ContextWalkStepSchema>;
