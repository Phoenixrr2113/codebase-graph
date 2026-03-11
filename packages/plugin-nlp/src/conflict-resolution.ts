/**
 * Temporal Conflict Resolution
 *
 * Detects when new facts contradict or supersede existing facts in the
 * knowledge graph. Uses LLM evaluation to determine if new information
 * invalidates prior information, then sets invalid_at on superseded edges.
 *
 * Based on the Graphiti temporal conflict resolution pattern:
 * 1. Before storing a new relationship, query for existing relationships
 *    between the same (or similar) entities.
 * 2. If candidates found, use LLM to evaluate contradiction.
 * 3. If contradiction detected, invalidate the old edge (set invalid_at).
 *
 * The bi-temporal schema already supports this:
 * - valid_at:   When the fact became true (set on creation)
 * - invalid_at: When the fact was superseded (set by conflict resolution)
 * - created_at: When the edge was inserted into the graph
 * - expired_at: When the edge record was logically deleted (admin action)
 */

import { generateText, type LanguageModel } from 'ai';
import { createLogger } from '@codegraph/logger';
import type { KnowledgeOperations, RelationshipResult } from '@codegraph/graph';

const logger = createLogger({ namespace: 'nlp:conflict-resolution' });

// ============================================================================
// Types
// ============================================================================

export interface ConflictResolutionConfig {
  /** LLM to use for contradiction evaluation. If omitted, LLM evaluation is skipped
   *  and only exact-match invalidation is performed. */
  llm?: LanguageModel;

  /** Whether to check for contradictions at all (default: true when llm is provided) */
  enabled?: boolean;

  /** Maximum number of existing edges to compare against per new edge (default: 5) */
  maxCandidates?: number;

  /** Model string for OpenRouter (used if no languageModel provided) */
  model?: string;
}

export interface ConflictCandidate {
  /** The existing relationship that may be contradicted */
  existing: RelationshipResult;
  /** The new fact text that may contradict it */
  newFact: string;
}

export interface ConflictResult {
  /** Whether a contradiction was detected */
  isContradiction: boolean;
  /** Brief explanation of why (from LLM) */
  reason: string;
  /** The existing edge that should be invalidated (if contradiction) */
  existingFact?: string;
}

export interface ConflictResolutionResult {
  /** Number of existing edges checked */
  checked: number;
  /** Number of contradictions detected */
  contradictions: number;
  /** Number of edges invalidated */
  invalidated: number;
  /** Details of each resolution */
  details: Array<{
    headText: string;
    tailText: string;
    oldRelationType: string;
    oldFact: string | null;
    newFact: string | null;
    reason: string;
  }>;
}

// ============================================================================
// Contradiction Detection
// ============================================================================

const CONTRADICTION_PROMPT = `You are a fact verification assistant. Given two facts about the same entities, determine if the NEW fact contradicts or supersedes the OLD fact.

A contradiction means the new information makes the old information no longer true. Examples:
- "We decided to use JWT" → "We switched from JWT to session tokens" = CONTRADICTION (old decision superseded)
- "Budget is $50k" → "Budget increased to $75k" = CONTRADICTION (old budget no longer valid)
- "Sarah likes coffee" → "Sarah joined the team" = NOT a contradiction (different topics)
- "Alice leads Project X" → "Bob now leads Project X" = CONTRADICTION (Alice no longer leads)
- "Using PostgreSQL" → "Also using Redis for caching" = NOT a contradiction (additive, not replacement)

Respond with EXACTLY one of:
CONTRADICTION: <brief reason>
NO_CONTRADICTION: <brief reason>

OLD FACT: {oldFact}
NEW FACT: {newFact}
ENTITIES: {headText} → {tailText} (relationship type: {relationType})

Your response:`;

/**
 * Use LLM to evaluate whether a new fact contradicts an existing fact.
 */
async function evaluateContradiction(
  llm: LanguageModel,
  existing: RelationshipResult,
  newFact: string,
): Promise<ConflictResult> {
  const oldFact = existing.fact
    ?? `${existing.headText} ${existing.relationType} ${existing.tailText}`;

  const prompt = CONTRADICTION_PROMPT
    .replace('{oldFact}', oldFact)
    .replace('{newFact}', newFact)
    .replace('{headText}', existing.headText)
    .replace('{tailText}', existing.tailText)
    .replace('{relationType}', existing.relationType);

  try {
    const result = await generateText({
      model: llm,
      prompt,
      temperature: 0.1,
    });

    const response = result.text.trim();

    if (response.startsWith('CONTRADICTION:')) {
      return {
        isContradiction: true,
        reason: response.replace('CONTRADICTION:', '').trim(),
        existingFact: oldFact,
      };
    }

    return {
      isContradiction: false,
      reason: response.replace('NO_CONTRADICTION:', '').trim(),
    };
  } catch (error) {
    logger.warn(`LLM evaluation failed: ${error}`);
    return {
      isContradiction: false,
      reason: 'LLM evaluation failed — keeping both facts',
    };
  }
}

// ============================================================================
// Main: Check and Resolve Conflicts
// ============================================================================

/**
 * Check for temporal conflicts between a new relationship and existing ones.
 *
 * Queries the knowledge graph for existing RELATES_TO edges between the same
 * entity pair (or with the same head entity and relationship type). If found,
 * uses LLM to evaluate contradiction. If contradiction detected, invalidates
 * the old edge by setting invalid_at.
 *
 * @param ops        - Knowledge graph operations instance
 * @param newRel     - The new relationship being stored
 * @param newFact    - Optional fact text for the new relationship
 * @param config     - Conflict resolution configuration
 * @returns Resolution results (contradictions found, edges invalidated)
 */
export async function checkAndResolveConflicts(
  ops: KnowledgeOperations,
  newRel: {
    headText: string;
    headType: string;
    tailText: string;
    tailType: string;
    type: string;
    fact?: string;
  },
  config: ConflictResolutionConfig = {},
): Promise<ConflictResolutionResult> {
  const maxCandidates = config.maxCandidates ?? 5;
  const result: ConflictResolutionResult = {
    checked: 0,
    contradictions: 0,
    invalidated: 0,
    details: [],
  };

  if (!config.llm) {
    logger.debug('No LLM provided for conflict resolution — skipping');
    return result;
  }

  // Step 1: Find existing relationships between the same entity pair
  // We look for any RELATES_TO edges where the head matches (by text)
  const existingRels = await ops.getRelationships({
    entityText: newRel.headText,
    limit: maxCandidates * 2, // over-fetch then filter
  });

  // Filter to edges involving the same tail entity (by text)
  const candidates = existingRels.filter(
    (r) =>
      r.tailText === newRel.tailText ||
      // Also check reverse direction (tail as head)
      (r.headText === newRel.tailText && r.tailText === newRel.headText),
  );

  // Also check: same relationship type even if different tail
  // (e.g., "Alice LEADS X" then "Bob LEADS X" — same type, same entity involved)
  const sameTypeRels = existingRels.filter(
    (r) =>
      r.relationType === newRel.type &&
      r.headText !== newRel.headText, // different head = potential replacement
  );

  // Combine and deduplicate candidates
  const allCandidates = [...candidates, ...sameTypeRels]
    .slice(0, maxCandidates);
  const seen = new Set<string>();
  const uniqueCandidates = allCandidates.filter((c) => {
    const key = `${c.headText}|${c.tailText}|${c.relationType}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  if (uniqueCandidates.length === 0) {
    logger.debug(`No existing relationships found for conflict check: ${newRel.headText} → ${newRel.tailText}`);
    return result;
  }

  result.checked = uniqueCandidates.length;
  logger.info(`Checking ${uniqueCandidates.length} candidate(s) for temporal conflict: ${newRel.headText} → ${newRel.tailText}`);

  // Step 2: Evaluate each candidate for contradiction
  const newFactText = newRel.fact
    ?? `${newRel.headText} ${newRel.type} ${newRel.tailText}`;

  for (const candidate of uniqueCandidates) {
    const evaluation = await evaluateContradiction(
      config.llm,
      candidate,
      newFactText,
    );

    if (evaluation.isContradiction) {
      result.contradictions++;

      // Step 3: Invalidate the old edge
      try {
        await ops.invalidateRelationship(
          candidate.headText,
          candidate.headType,
          candidate.tailText,
          candidate.tailType,
          candidate.relationType,
        );
        result.invalidated++;
        result.details.push({
          headText: candidate.headText,
          tailText: candidate.tailText,
          oldRelationType: candidate.relationType,
          oldFact: candidate.fact,
          newFact: newFactText,
          reason: evaluation.reason,
        });

        logger.info(
          `Contradiction resolved: "${candidate.fact ?? candidate.relationType}" superseded by "${newFactText}" — ${evaluation.reason}`,
        );
      } catch (error) {
        logger.warn(`Failed to invalidate edge: ${error}`);
      }
    }
  }

  return result;
}
