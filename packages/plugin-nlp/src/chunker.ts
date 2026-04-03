/**
 * Token-aware Text Chunker
 *
 * Splits arbitrary text into chunks respecting sentence boundaries and token limits.
 * Foundation for document ingestion — every loader produces text, the chunker
 * prepares it for extractAndStore().
 *
 * No external dependencies — uses a word-count heuristic for token estimation.
 */

// ============================================================================
// Types
// ============================================================================

export interface ChunkConfig {
  /** Maximum tokens per chunk (default: 512) */
  maxTokens?: number;
  /** Overlap tokens from previous chunk (default: 50) */
  overlap?: number;
  /** Chunking strategy (default: 'sentence') */
  strategy?: 'sentence' | 'paragraph';
}

export interface TextChunk {
  /** The chunk text */
  text: string;
  /** Zero-based chunk index */
  index: number;
  /** Estimated token count */
  tokenCount: number;
  /** Start character offset in original text */
  startOffset: number;
  /** End character offset in original text */
  endOffset: number;
}

// ============================================================================
// Token Estimation
// ============================================================================

/**
 * Estimate token count from text using word-count heuristic.
 * Approximation: tokens ≈ words × 1.3 (accounts for subword tokenization).
 */
export function estimateTokens(text: string): number {
  if (!text) return 0;
  const wordCount = text.split(/\s+/).filter(Boolean).length;
  return Math.ceil(wordCount * 1.3);
}

// ============================================================================
// Sentence Splitting
// ============================================================================

/**
 * Split text into sentences with character offsets.
 * Handles common abbreviations and edge cases.
 */
function splitSentences(text: string): Array<{ text: string; start: number; end: number }> {
  const sentences: Array<{ text: string; start: number; end: number }> = [];

  // Regex: split on sentence-ending punctuation followed by whitespace or end of string.
  // Negative lookbehind for common abbreviations (Mr., Mrs., Dr., etc., vs., e.g., i.e.)
  const sentenceRegex = /(?<=[.!?])\s+(?=[A-Z"'\u201C\u201D])|(?<=[.!?])\s*$/gm;

  let lastIndex = 0;
  let match: RegExpExecArray | null;

  // eslint-disable-next-line no-cond-assign
  while ((match = sentenceRegex.exec(text)) !== null) {
    const sentenceText = text.slice(lastIndex, match.index + 1).trim();
    if (sentenceText) {
      sentences.push({
        text: sentenceText,
        start: lastIndex,
        end: match.index + 1,
      });
    }
    lastIndex = match.index + match[0].length;
  }

  // Remaining text after last match
  const remaining = text.slice(lastIndex).trim();
  if (remaining) {
    sentences.push({
      text: remaining,
      start: lastIndex,
      end: text.length,
    });
  }

  // If no sentences were found (no sentence-ending punctuation), return whole text
  if (sentences.length === 0 && text.trim()) {
    sentences.push({ text: text.trim(), start: 0, end: text.length });
  }

  return sentences;
}

/**
 * Split text into paragraphs (double newline separated).
 */
function splitParagraphs(text: string): Array<{ text: string; start: number; end: number }> {
  const paragraphs: Array<{ text: string; start: number; end: number }> = [];
  const regex = /\n\s*\n/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  // eslint-disable-next-line no-cond-assign
  while ((match = regex.exec(text)) !== null) {
    const pText = text.slice(lastIndex, match.index).trim();
    if (pText) {
      paragraphs.push({ text: pText, start: lastIndex, end: match.index });
    }
    lastIndex = match.index + match[0].length;
  }

  const remaining = text.slice(lastIndex).trim();
  if (remaining) {
    paragraphs.push({ text: remaining, start: lastIndex, end: text.length });
  }

  if (paragraphs.length === 0 && text.trim()) {
    paragraphs.push({ text: text.trim(), start: 0, end: text.length });
  }

  return paragraphs;
}

// ============================================================================
// Chunker
// ============================================================================

/**
 * Split text into token-limited chunks respecting sentence or paragraph boundaries.
 *
 * - Chunks respect maxTokens limit
 * - Breaks on sentence/paragraph boundaries (not mid-word)
 * - Overlap includes N tokens from previous chunk for context continuity
 * - Single sentences longer than maxTokens are preserved (not split mid-sentence)
 */
export function chunkText(text: string, config?: ChunkConfig): TextChunk[] {
  const maxTokens = config?.maxTokens ?? 512;
  const overlap = config?.overlap ?? 50;
  const strategy = config?.strategy ?? 'sentence';

  if (!text || !text.trim()) {
    return [];
  }

  // If text fits in one chunk, return it directly
  const totalTokens = estimateTokens(text);
  if (totalTokens <= maxTokens) {
    return [{
      text: text.trim(),
      index: 0,
      tokenCount: totalTokens,
      startOffset: 0,
      endOffset: text.length,
    }];
  }

  // Split into units (sentences or paragraphs)
  const units = strategy === 'paragraph' ? splitParagraphs(text) : splitSentences(text);

  const chunks: TextChunk[] = [];
  let currentUnits: Array<{ text: string; start: number; end: number }> = [];
  let currentTokens = 0;

  for (const unit of units) {
    const unitTokens = estimateTokens(unit.text);

    // If adding this unit would exceed the limit AND we have content, emit chunk
    if (currentTokens + unitTokens > maxTokens && currentUnits.length > 0) {
      const chunkStr = currentUnits.map(u => u.text).join(' ');
      const firstUnit = currentUnits[0]!;
      const lastUnit = currentUnits[currentUnits.length - 1]!;
      chunks.push({
        text: chunkStr,
        index: chunks.length,
        tokenCount: estimateTokens(chunkStr),
        startOffset: firstUnit.start,
        endOffset: lastUnit.end,
      });

      // Calculate overlap: keep trailing units that fit within overlap token budget
      const overlapUnits: typeof currentUnits = [];
      let overlapTokens = 0;
      for (let i = currentUnits.length - 1; i >= 0; i--) {
        const cu = currentUnits[i]!;
        const uTokens = estimateTokens(cu.text);
        if (overlapTokens + uTokens > overlap) break;
        overlapUnits.unshift(cu);
        overlapTokens += uTokens;
      }

      currentUnits = [...overlapUnits];
      currentTokens = overlapTokens;
    }

    // Add unit (even if it alone exceeds maxTokens — preserve whole sentences)
    currentUnits.push(unit);
    currentTokens += unitTokens;
  }

  // Emit final chunk
  if (currentUnits.length > 0) {
    const chunkTextStr = currentUnits.map(u => u.text).join(' ');
    const firstUnit = currentUnits[0]!;
    const lastUnit = currentUnits[currentUnits.length - 1]!;
    chunks.push({
      text: chunkTextStr,
      index: chunks.length,
      tokenCount: estimateTokens(chunkTextStr),
      startOffset: firstUnit.start,
      endOffset: lastUnit.end,
    });
  }

  return chunks;
}
