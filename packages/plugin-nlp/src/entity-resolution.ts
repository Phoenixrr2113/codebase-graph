/**
 * Entity Resolution — Cross-episode deduplication
 *
 * After episodic extraction, the same entity may appear under different names
 * across episodes (e.g., "Sarah" in episode 3, "Sarah Chen" in episode 7).
 *
 * THREE-TIER resolution strategy (cheapest first, LLM only when needed):
 *
 *   Tier 1 — Exact text match (free, instant):
 *     Normalize entity texts (lowercase, trim), exact match → auto-merge.
 *     Catches: "Sarah" == "Sarah", "processPayment" == "processPayment"
 *
 *   Tier 2 — Embedding similarity (cheap, fast):
 *     Compute pairwise cosine similarity on entity embeddings.
 *     cosine > 0.95 → auto-merge (very high confidence)
 *     cosine > 0.85 → candidate for Tier 3 LLM verification
 *     cosine < 0.85 → keep separate, no LLM call
 *
 *   Tier 3 — LLM verification (expensive, only for ambiguous cases):
 *     Only for scores in 0.85-0.95 range (the "maybe" zone).
 *     LLM prompt: "Are these the same entity? A: 'Sarah', B: 'Sarah Chen'"
 *
 * Usage:
 *   const result = await resolveEntities(kgOps, {
 *     llm: model,  // optional, only needed for Tier 3
 *   });
 *   // result: { merged: 5, kept: 42, tier1: 3, tier2: 1, tier3: 1 }
 */

import { createLogger } from '@codegraph/logger';
import { generateText, type LanguageModel } from 'ai';
import type { KnowledgeOperations } from '@codegraph/graph';
import { generateEmbedding, isEmbeddingAvailable } from './embeddings';
import { buildEntityEmbeddingText } from './embedding-text';
import { DeltaOpSchema, type DeltaOp } from './schemas';

const logger = createLogger({ namespace: 'nlp:entity-resolution' });

// ============================================================================
// Types
// ============================================================================

export interface EntityResolutionConfig {
  /** LLM for Tier 3 verification (optional — if omitted, Tier 3 is skipped) */
  llm?: LanguageModel | undefined;
  /** Auto-merge threshold for embedding similarity (default: 0.95) */
  autoMergeThreshold?: number;
  /** Lower bound for LLM verification candidates (default: 0.85) */
  candidateThreshold?: number;
  /** Maximum entities to consider (default: 500) */
  entityLimit?: number;
  /** Only resolve entities from a specific extraction batch (sampleId prefix) */
  sampleIdFilter?: string | undefined;
  /** Progress callback */
  onProgress?: (phase: string, current: number, total: number) => void;
}

export interface EntityResolutionResult {
  /** Total entities considered */
  total: number;
  /** Number of entities merged (removed as duplicates) */
  merged: number;
  /** Number of entities kept (canonical + unique) */
  kept: number;
  /** Merges from Tier 1 (exact text match) */
  tier1Merges: number;
  /** Merges from Tier 2 (embedding similarity > autoMergeThreshold) */
  tier2Merges: number;
  /** Merges from Tier 3 (LLM verification) */
  tier3Merges: number;
  /** Number of LLM calls made (Tier 3) */
  llmCalls: number;
  /** Details of each merge performed */
  merges: Array<{
    canonical: string;
    duplicate: string;
    tier: 1 | 2 | 3;
    similarity?: number | undefined;
  }>;
}

/** Internal: entity with optional embedding */
interface EntityWithEmbedding {
  text: string;
  type: string;
  normalized: string;
  embedding?: number[] | undefined;
}

/** Internal: a merge group (canonical + duplicates to merge into it) */
interface MergeGroup {
  canonical: EntityWithEmbedding;
  duplicates: EntityWithEmbedding[];
  tier: 1 | 2 | 3;
  similarity?: number;
}

// ============================================================================
// Cosine Similarity
// ============================================================================

function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length || a.length === 0) return 0;
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i]! * b[i]!;
    normA += a[i]! * a[i]!;
    normB += b[i]! * b[i]!;
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  return denom === 0 ? 0 : dot / denom;
}

// ============================================================================
// Tier 1: Exact Text Match
// ============================================================================

/**
 * Group entities by normalized text (lowercase, trimmed).
 * Returns merge groups where the first entity is canonical.
 */
function findExactMatches(entities: EntityWithEmbedding[]): MergeGroup[] {
  const groups = new Map<string, EntityWithEmbedding[]>();

  for (const entity of entities) {
    const key = `${entity.normalized}::${entity.type}`;
    const group = groups.get(key);
    if (group) {
      group.push(entity);
    } else {
      groups.set(key, [entity]);
    }
  }

  const merges: MergeGroup[] = [];
  for (const group of groups.values()) {
    if (group.length > 1) {
      // Pick canonical: longest text wins, then prefer proper casing (has uppercase)
      group.sort((a, b) => {
        const lenDiff = b.text.length - a.text.length;
        if (lenDiff !== 0) return lenDiff;
        // Tiebreaker: prefer text with uppercase letters (proper casing)
        const aHasUpper = /[A-Z]/.test(a.text);
        const bHasUpper = /[A-Z]/.test(b.text);
        if (aHasUpper && !bHasUpper) return -1;
        if (!aHasUpper && bHasUpper) return 1;
        // Final tiebreaker: lexicographic
        return a.text.localeCompare(b.text);
      });
      merges.push({
        canonical: group[0]!,
        duplicates: group.slice(1),
        tier: 1,
      });
    }
  }

  return merges;
}

// ============================================================================
// Tier 2: Embedding Similarity
// ============================================================================

/**
 * Find pairs with high embedding similarity.
 * Only considers entities that weren't already merged in Tier 1.
 *
 * Returns two sets of merges:
 * - autoMerge: similarity > autoMergeThreshold (merge without LLM)
 * - candidates: similarity between candidateThreshold and autoMergeThreshold (needs LLM)
 */
function findEmbeddingSimilarPairs(
  entities: EntityWithEmbedding[],
  autoMergeThreshold: number,
  candidateThreshold: number,
): { autoMerge: MergeGroup[]; candidates: Array<{ a: EntityWithEmbedding; b: EntityWithEmbedding; similarity: number }> } {
  const autoMerge: MergeGroup[] = [];
  const candidates: Array<{ a: EntityWithEmbedding; b: EntityWithEmbedding; similarity: number }> = [];

  // Only consider entities with embeddings
  const withEmbeddings = entities.filter((e) => e.embedding && e.embedding.length > 0);

  // Group by type for O(n²/k) instead of O(n²) comparisons
  // Only entities of the same type can be duplicates, so skip cross-type pairs entirely
  const byType = new Map<string, typeof withEmbeddings>();
  for (const entity of withEmbeddings) {
    const bucket = byType.get(entity.type);
    if (bucket) {
      bucket.push(entity);
    } else {
      byType.set(entity.type, [entity]);
    }
  }

  // Track which entities have already been merged
  const merged = new Set<string>();

  for (const [, bucket] of byType) {
    for (let i = 0; i < bucket.length; i++) {
      const a = bucket[i]!;
      const keyA = `${a.text}::${a.type}`;
      if (merged.has(keyA)) continue;

      for (let j = i + 1; j < bucket.length; j++) {
        const b = bucket[j]!;
        const keyB = `${b.text}::${b.type}`;
        if (merged.has(keyB)) continue;

        const sim = cosineSimilarity(a.embedding!, b.embedding!);

        if (sim >= autoMergeThreshold) {
          // Auto-merge: very high similarity
          autoMerge.push({
            canonical: a.text.length >= b.text.length ? a : b,
            duplicates: [a.text.length >= b.text.length ? b : a],
            tier: 2,
            similarity: sim,
          });
          merged.add(keyA);
          merged.add(keyB);
        } else if (sim >= candidateThreshold) {
          // Candidate for LLM verification
          candidates.push({ a, b, similarity: sim });
        }
      }
    }
  }

  return { autoMerge, candidates };
}

// ============================================================================
// Tier 3: LLM Verification
// ============================================================================

/**
 * Use LLM to compare two candidate entities and return a typed DeltaOp.
 *
 * Returns a Zod-validated discriminated union (MergeOp | KeepOp | RenameOp).
 * Malformed or unparseable LLM output falls back to a safe "keep" op so that
 * no merges happen on parse failure (conservative default).
 */
async function tier3Compare(
  entityA: EntityWithEmbedding,
  entityB: EntityWithEmbedding,
  llm: LanguageModel,
): Promise<DeltaOp> {
  const prompt = `Compare these two entities and decide whether to merge them or keep them separate.

Entity A: ${JSON.stringify({ text: entityA.text, type: entityA.type })}
Entity B: ${JSON.stringify({ text: entityB.text, type: entityB.type })}

Respond with a JSON object matching exactly one of these shapes:
- {"op": "merge", "canonical": "<text of survivor entity>", "duplicate": "<text of merged-in entity>", "reason": "<one sentence why>"}
- {"op": "keep", "reason": "<one sentence why they should stay separate>"}

Rules:
- If they clearly refer to the same real-world thing (e.g., "Sarah" and "Sarah Chen"), use merge with the longer/more specific text as canonical.
- If they are different entities that happen to be similar, use keep.
- Consider entity types: different types strongly suggest different entities.

Only output the JSON object, no other text.`;

  let raw: string;
  try {
    const { text } = await generateText({
      model: llm,
      prompt,
      temperature: 0,
    });
    raw = text.trim();
  } catch (err) {
    logger.warn(`Tier 3 LLM call failed for "${entityA.text}" vs "${entityB.text}": ${err}`);
    return { op: 'keep', reason: 'LLM call failed; defaulting to keep.' };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    logger.warn(`Tier 3 LLM output was not parseable JSON for "${entityA.text}" vs "${entityB.text}": ${raw.slice(0, 100)}`);
    return { op: 'keep', reason: 'LLM output was not parseable JSON; defaulting to keep.' };
  }

  const result = DeltaOpSchema.safeParse(parsed);
  if (!result.success) {
    logger.warn(`Tier 3 DeltaOp schema validation failed for "${entityA.text}" vs "${entityB.text}": ${result.error.message.slice(0, 100)}`);
    return { op: 'keep', reason: `LLM output failed schema validation: ${result.error.message.slice(0, 100)}` };
  }

  return result.data;
}

// ============================================================================
// Main Entry Point
// ============================================================================

/**
 * Resolve duplicate entities across episodes using three-tier strategy.
 *
 * @param kgOps  - Knowledge graph operations (for querying and merging entities)
 * @param config - Resolution configuration
 * @returns Summary of resolution actions taken
 */
export async function resolveEntities(
  kgOps: KnowledgeOperations,
  config: EntityResolutionConfig = {},
): Promise<EntityResolutionResult> {
  const autoMergeThreshold = config.autoMergeThreshold ?? 0.95;
  const candidateThreshold = config.candidateThreshold ?? 0.85;
  const entityLimit = config.entityLimit ?? 500;

  const result: EntityResolutionResult = {
    total: 0,
    merged: 0,
    kept: 0,
    tier1Merges: 0,
    tier2Merges: 0,
    tier3Merges: 0,
    llmCalls: 0,
    merges: [],
  };

  // Step 1: Load all entities
  const allEntities = await kgOps.searchEntities({ limit: entityLimit });
  result.total = allEntities.length;

  if (allEntities.length < 2) {
    result.kept = allEntities.length;
    logger.info('Fewer than 2 entities — nothing to resolve');
    return result;
  }

  logger.info(`Entity resolution: ${allEntities.length} entities to consider`);

  // Build entity list with normalized text and stored embeddings
  const entities: EntityWithEmbedding[] = allEntities.map((e) => ({
    text: e.text,
    type: e.type,
    normalized: e.text.toLowerCase().trim(),
    embedding: e.embedding ? Array.from(e.embedding) : undefined,
  }));

  // ===========================================================================
  // Tier 1: Exact text match (free)
  // ===========================================================================

  config.onProgress?.('tier1', 0, entities.length);

  const exactMerges = findExactMatches(entities);

  for (const merge of exactMerges) {
    for (const dup of merge.duplicates) {
      try {
        const mergeResult = await kgOps.mergeEntities(
          merge.canonical.text, merge.canonical.type,
          dup.text, dup.type,
        );
        if (!mergeResult.success) {
          logger.warn(
            `Tier 1 merge incomplete: "${dup.text}" → "${merge.canonical.text}": ${mergeResult.errors.join('; ')}`,
          );
          continue;
        }
        if (!mergeResult.deleted) {
          // success but a no-op: the duplicate was already gone (e.g. consumed
          // by an earlier merge in this same run, or by a concurrent process).
          // Nothing actually happened here, so it must not be counted.
          logger.info(
            `Tier 1 merge was a no-op: "${dup.text}" → "${merge.canonical.text}" (duplicate already gone)`,
          );
          continue;
        }
        result.tier1Merges++;
        result.merged++;
        result.merges.push({
          canonical: merge.canonical.text,
          duplicate: dup.text,
          tier: 1,
        });
      } catch (err) {
        logger.warn(`Tier 1 merge failed: "${dup.text}" → "${merge.canonical.text}": ${err}`);
      }
    }
  }

  config.onProgress?.('tier1', entities.length, entities.length);

  // Remove merged entities from further consideration
  const mergedTexts = new Set(
    result.merges.map((m) => `${m.duplicate}::${entities.find((e) => e.text === m.duplicate)?.type}`),
  );
  const remaining = entities.filter(
    (e) => !mergedTexts.has(`${e.text}::${e.type}`),
  );

  logger.info(`Tier 1: ${result.tier1Merges} exact matches merged, ${remaining.length} remaining`);

  // ===========================================================================
  // Tier 2: Embedding similarity (cheap)
  // ===========================================================================

  if (remaining.length < 2 || !isEmbeddingAvailable()) {
    result.kept = result.total - result.merged;
    return result;
  }

  config.onProgress?.('tier2', 0, remaining.length);

  // Generate embeddings for remaining entities (if not already present)
  for (const entity of remaining) {
    if (!entity.embedding) {
      try {
        const embText = buildEntityEmbeddingText({ text: entity.text, type: entity.type });
        const embResult = await generateEmbedding(embText);
        if (embResult) {
          entity.embedding = embResult.embedding;
        }
      } catch {
        // Embedding generation failed — skip this entity for Tier 2/3
      }
    }
  }

  config.onProgress?.('tier2', Math.floor(remaining.length / 2), remaining.length);

  const { autoMerge, candidates } = findEmbeddingSimilarPairs(
    remaining,
    autoMergeThreshold,
    candidateThreshold,
  );

  // Apply auto-merge (Tier 2)
  for (const merge of autoMerge) {
    for (const dup of merge.duplicates) {
      try {
        const mergeResult = await kgOps.mergeEntities(
          merge.canonical.text, merge.canonical.type,
          dup.text, dup.type,
        );
        if (!mergeResult.success) {
          logger.warn(
            `Tier 2 merge incomplete: "${dup.text}" → "${merge.canonical.text}": ${mergeResult.errors.join('; ')}`,
          );
          continue;
        }
        if (!mergeResult.deleted) {
          logger.info(
            `Tier 2 merge was a no-op: "${dup.text}" → "${merge.canonical.text}" (duplicate already gone)`,
          );
          continue;
        }
        result.tier2Merges++;
        result.merged++;
        result.merges.push({
          canonical: merge.canonical.text,
          duplicate: dup.text,
          tier: 2,
          similarity: merge.similarity,
        });
      } catch (err) {
        logger.warn(`Tier 2 merge failed: "${dup.text}" → "${merge.canonical.text}": ${err}`);
      }
    }
  }

  config.onProgress?.('tier2', remaining.length, remaining.length);

  logger.info(
    `Tier 2: ${result.tier2Merges} embedding auto-merges, ${candidates.length} LLM candidates`,
  );

  // ===========================================================================
  // Tier 3: LLM verification (expensive, only for ambiguous)
  // ===========================================================================

  if (candidates.length > 0 && config.llm) {
    config.onProgress?.('tier3', 0, candidates.length);

    for (let i = 0; i < candidates.length; i++) {
      const { a, b, similarity } = candidates[i]!;

      result.llmCalls++;
      const op = await tier3Compare(a, b, config.llm);

      switch (op.op) {
        case 'merge': {
          // LLM named canonical/duplicate by text; map back to our entity objects.
          // Fall back to length heuristic if the LLM returned text we can't match.
          const canonicalText = op.canonical;
          const duplicateText = op.duplicate;
          const canonicalEntity = (a.text === canonicalText ? a : b.text === canonicalText ? b : null)
            ?? (a.text.length >= b.text.length ? a : b);
          const duplicateEntity = (a.text === duplicateText ? a : b.text === duplicateText ? b : null)
            ?? (a.text.length >= b.text.length ? b : a);

          try {
            const mergeResult = await kgOps.mergeEntities(
              canonicalEntity.text, canonicalEntity.type,
              duplicateEntity.text, duplicateEntity.type,
            );
            if (!mergeResult.success) {
              logger.warn(
                `Tier 3 merge incomplete: "${duplicateEntity.text}" → "${canonicalEntity.text}": ${mergeResult.errors.join('; ')}`,
              );
              break;
            }
            if (!mergeResult.deleted) {
              logger.info(
                `Tier 3 merge was a no-op: "${duplicateEntity.text}" → "${canonicalEntity.text}" (duplicate already gone)`,
              );
              break;
            }
            result.tier3Merges++;
            result.merged++;
            result.merges.push({
              canonical: canonicalEntity.text,
              duplicate: duplicateEntity.text,
              tier: 3,
              similarity,
            });
          } catch (err) {
            logger.warn(`Tier 3 merge failed: "${duplicateEntity.text}" → "${canonicalEntity.text}": ${err}`);
          }
          break;
        }
        case 'keep':
          logger.info('entity-resolution', { tier: 3, op: 'keep', a: a.text, b: b.text, reason: op.reason });
          break;
        case 'rename':
          // RenameOp is uncommon in entity comparison context; log and skip.
          logger.info('entity-resolution', { tier: 3, op: 'rename', entity: op.entity, newText: op.newText, reason: op.reason });
          break;
      }

      config.onProgress?.('tier3', i + 1, candidates.length);
    }

    logger.info(
      `Tier 3: ${result.tier3Merges} LLM-verified merges from ${candidates.length} candidates (${result.llmCalls} LLM calls)`,
    );
  } else if (candidates.length > 0 && !config.llm) {
    logger.info(
      `Tier 3: skipped ${candidates.length} LLM candidates (no LLM configured)`,
    );
  }

  result.kept = result.total - result.merged;

  logger.info(
    `Entity resolution complete: ${result.merged} merged, ${result.kept} kept ` +
    `(tier1: ${result.tier1Merges}, tier2: ${result.tier2Merges}, tier3: ${result.tier3Merges})`,
  );

  return result;
}
