/**
 * Query sanitizer — 4-step fallback ladder.
 *
 * Mempalace research showed agents prepending 2k-char system prompts to
 * short questions collapses R@10 from 89.8% → 1.0%. This ladder mitigates
 * the most common contamination pattern without rejecting valid long queries.
 *
 * Ladder:
 *   1. ≤200 chars → passthrough (after trim)
 *   2. Extract last ?-terminated sentence
 *   3. Extract last sentence (any terminator: . ! ?)
 *   4. Truncate to last 200 chars
 */

const PASSTHROUGH_MAX = 200;
const HARD_CAP = 200;

export interface SanitizedQuery {
  query: string;
  warnings: string[];
}

export function sanitizeQuery(input: string): SanitizedQuery {
  const trimmed = input.trim();
  const warnings: string[] = [];

  // Empty input
  if (trimmed.length === 0) {
    warnings.push('empty query after trim');
    return { query: '', warnings };
  }

  // Step 1: passthrough for short queries
  if (trimmed.length <= PASSTHROUGH_MAX) {
    return { query: trimmed, warnings };
  }

  warnings.push(`input length ${trimmed.length} exceeds ${PASSTHROUGH_MAX}; sanitizing`);

  // Step 2: extract last ?-terminated sentence
  const sentences = trimmed.split(/(?<=[.!?])\s+/);
  const lastQuestion = [...sentences].reverse().find(s => s.trimEnd().endsWith('?'));
  if (lastQuestion) {
    const q = lastQuestion.trim();
    if (q.length > 0 && q.length <= HARD_CAP) {
      warnings.push('extracted last question-terminated sentence');
      return { query: q, warnings };
    }
  }

  // Step 3: extract last sentence (any terminator)
  const lastSentence = [...sentences].reverse().find(s => /[.!?]$/.test(s.trimEnd()));
  if (lastSentence) {
    const q = lastSentence.trim();
    if (q.length > 0 && q.length <= HARD_CAP) {
      warnings.push('extracted last sentence');
      return { query: q, warnings };
    }
  }

  // Step 4: truncate to last HARD_CAP chars
  warnings.push(`no sentence boundary found; truncated to last ${HARD_CAP} chars`);
  return { query: trimmed.slice(-HARD_CAP).trim(), warnings };
}
