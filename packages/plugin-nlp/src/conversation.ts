/**
 * Conversation Chunking & Episodic Processing
 *
 * Parses conversation text into episodes (individual messages or logical chunks)
 * for sequential NLP extraction. Supports multiple conversation formats:
 *
 *   1. Chat-style:       "Speaker: message"
 *   2. Timestamped:      "[2024-01-15 10:30] Speaker: message"
 *   3. Paragraph-style:  Split on double newlines
 *   4. Auto-detect:      Tries each format in order
 *
 * Preserves speaker attribution and temporal ordering for downstream extraction.
 */

import { createLogger } from '@codegraph/logger';

const logger = createLogger({ namespace: 'nlp:conversation' });

// ============================================================================
// Types
// ============================================================================

/** A single episode (message or chunk) from a conversation */
export interface Episode {
  /** 0-based index in the conversation */
  index: number;
  /** Raw text content of the episode */
  text: string;
  /** Speaker/author (if extractable) */
  speaker?: string | undefined;
  /** ISO timestamp (if extractable from timestamped format) */
  timestamp?: string | undefined;
}

/** Supported conversation formats */
export type ConversationFormat = 'chat' | 'timestamped' | 'paragraphs' | 'auto';

/** Options for conversation chunking */
export interface ChunkOptions {
  /** Conversation format (default: 'auto') */
  format?: ConversationFormat;
  /** Maximum episode text length — longer messages are split (default: 2000 chars) */
  maxEpisodeLength?: number;
  /** Minimum episode text length — shorter chunks are merged with prior (default: 10 chars) */
  minEpisodeLength?: number;
}

/** Result of conversation chunking */
export interface ChunkResult {
  /** Extracted episodes */
  episodes: Episode[];
  /** Detected format */
  format: ConversationFormat;
  /** Number of unique speakers found */
  speakerCount: number;
  /** Unique speaker names found */
  speakers: string[];
}

// ============================================================================
// Format Detection
// ============================================================================

/**
 * Regex patterns for each format.
 *
 * Timestamped: [2024-01-15 10:30] Speaker: message
 *              [2024-01-15T10:30:00Z] Speaker: message
 *              [10:30 AM] Speaker: message
 */
const TIMESTAMPED_LINE = /^\[([^\]]+)\]\s+([^:]+):\s*(.*)/;

/**
 * Chat-style: Speaker: message
 * Must start at beginning of line, speaker name is 1-40 chars without colons.
 */
const CHAT_LINE = /^([A-Za-z][A-Za-z0-9 _.'-]{0,39}):\s+(.*)/;

/**
 * Detect conversation format by examining the first few lines.
 */
function detectFormat(text: string): ConversationFormat {
  const lines = text.split('\n').filter((l) => l.trim().length > 0).slice(0, 20);

  if (lines.length === 0) return 'paragraphs';

  // Check for timestamped format
  let timestampedCount = 0;
  let chatCount = 0;

  for (const line of lines) {
    if (TIMESTAMPED_LINE.test(line)) timestampedCount++;
    else if (CHAT_LINE.test(line)) chatCount++;
  }

  // If >50% of non-empty lines match timestamped format
  if (timestampedCount > lines.length * 0.4) return 'timestamped';

  // If >50% of non-empty lines match chat format
  if (chatCount > lines.length * 0.4) return 'chat';

  // Default to paragraph splitting
  return 'paragraphs';
}

// ============================================================================
// Parsers
// ============================================================================

/**
 * Parse timestamped conversation:
 *   [2024-01-15 10:30] Alice: Let's discuss the payment module
 *   [2024-01-15 10:31] Bob: Sure, I think we need to refactor it
 */
function parseTimestamped(text: string, options: Required<ChunkOptions>): Episode[] {
  const episodes: Episode[] = [];
  const lines = text.split('\n');

  let current: { speaker?: string; timestamp?: string; lines: string[] } | null = null;

  for (const line of lines) {
    const match = TIMESTAMPED_LINE.exec(line.trim());

    if (match) {
      // Flush previous episode
      if (current && current.lines.length > 0) {
        const text = current.lines.join('\n').trim();
        if (text.length >= options.minEpisodeLength) {
          episodes.push({
            index: episodes.length,
            text,
            speaker: current.speaker,
            timestamp: normalizeTimestamp(current.timestamp),
          });
        }
      }

      current = {
        speaker: match[2]!.trim(),
        timestamp: match[1]!.trim(),
        lines: match[3] ? [match[3]] : [],
      };
    } else if (current && line.trim().length > 0) {
      // Continuation line for current message
      current.lines.push(line.trim());
    }
  }

  // Flush last episode
  if (current && current.lines.length > 0) {
    const text = current.lines.join('\n').trim();
    if (text.length >= options.minEpisodeLength) {
      episodes.push({
        index: episodes.length,
        text,
        speaker: current.speaker,
        timestamp: normalizeTimestamp(current.timestamp),
      });
    }
  }

  return splitLongEpisodes(episodes, options.maxEpisodeLength);
}

/**
 * Parse chat-style conversation:
 *   Alice: Let's discuss the payment module
 *   Bob: Sure, I think we need to refactor it
 */
function parseChat(text: string, options: Required<ChunkOptions>): Episode[] {
  const episodes: Episode[] = [];
  const lines = text.split('\n');

  let current: { speaker?: string; lines: string[] } | null = null;

  for (const line of lines) {
    const match = CHAT_LINE.exec(line.trim());

    if (match) {
      // Flush previous episode
      if (current && current.lines.length > 0) {
        const text = current.lines.join('\n').trim();
        if (text.length >= options.minEpisodeLength) {
          episodes.push({
            index: episodes.length,
            text,
            speaker: current.speaker,
          });
        }
      }

      current = {
        speaker: match[1]!.trim(),
        lines: match[2] ? [match[2]] : [],
      };
    } else if (current && line.trim().length > 0) {
      // Continuation line
      current.lines.push(line.trim());
    } else if (!current && line.trim().length > 0) {
      // Line before first speaker — treat as system/context text
      current = { lines: [line.trim()] };
    }
  }

  // Flush last episode
  if (current && current.lines.length > 0) {
    const text = current.lines.join('\n').trim();
    if (text.length >= options.minEpisodeLength) {
      episodes.push({
        index: episodes.length,
        text,
        speaker: current.speaker,
      });
    }
  }

  return splitLongEpisodes(episodes, options.maxEpisodeLength);
}

/**
 * Parse paragraph-style text:
 *   Split on double newlines (blank line separators)
 */
function parseParagraphs(text: string, options: Required<ChunkOptions>): Episode[] {
  const paragraphs = text
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter((p) => p.length >= options.minEpisodeLength);

  const episodes: Episode[] = paragraphs.map((p, i) => ({
    index: i,
    text: p,
  }));

  return splitLongEpisodes(episodes, options.maxEpisodeLength);
}

// ============================================================================
// Helpers
// ============================================================================

/**
 * Try to normalize a timestamp string to ISO 8601.
 * Returns the original string if parsing fails.
 */
function normalizeTimestamp(ts?: string): string | undefined {
  if (!ts) return undefined;

  try {
    // Try direct ISO parse
    const d = new Date(ts);
    if (!isNaN(d.getTime())) return d.toISOString();
  } catch { /* fall through */ }

  // Return as-is if we can't parse
  return ts;
}

/**
 * Split episodes that exceed maxLength into smaller chunks.
 * Preserves speaker and timestamp on sub-episodes.
 */
function splitLongEpisodes(episodes: Episode[], maxLength: number): Episode[] {
  const result: Episode[] = [];

  for (const ep of episodes) {
    if (ep.text.length <= maxLength) {
      result.push({ ...ep, index: result.length });
    } else {
      // Split by sentences (period/question/exclamation followed by space)
      const sentences = ep.text.split(/(?<=[.!?])\s+/);
      let chunk = '';

      for (const sentence of sentences) {
        if (chunk.length + sentence.length > maxLength && chunk.length > 0) {
          result.push({
            index: result.length,
            text: chunk.trim(),
            speaker: ep.speaker,
            timestamp: ep.timestamp,
          });
          chunk = '';
        }
        chunk += (chunk ? ' ' : '') + sentence;
      }

      if (chunk.trim().length > 0) {
        result.push({
          index: result.length,
          text: chunk.trim(),
          speaker: ep.speaker,
          timestamp: ep.timestamp,
        });
      }
    }
  }

  return result;
}

// ============================================================================
// Main Entry Point
// ============================================================================

/**
 * Chunk a conversation into episodes for sequential extraction.
 *
 * @param text    - Full conversation text
 * @param options - Chunking options (format, limits)
 * @returns Episodes with speaker attribution and temporal ordering
 */
export function chunkConversation(
  text: string,
  options: ChunkOptions = {},
): ChunkResult {
  const opts: Required<ChunkOptions> = {
    format: options.format ?? 'auto',
    maxEpisodeLength: options.maxEpisodeLength ?? 2000,
    minEpisodeLength: options.minEpisodeLength ?? 10,
  };

  const format = opts.format === 'auto' ? detectFormat(text) : opts.format;

  let episodes: Episode[];

  switch (format) {
    case 'timestamped':
      episodes = parseTimestamped(text, opts);
      break;
    case 'chat':
      episodes = parseChat(text, opts);
      break;
    case 'paragraphs':
    default:
      episodes = parseParagraphs(text, opts);
      break;
  }

  // Collect unique speakers
  const speakerSet = new Set<string>();
  for (const ep of episodes) {
    if (ep.speaker) speakerSet.add(ep.speaker);
  }

  logger.debug(
    `Chunked conversation: ${episodes.length} episodes, ${speakerSet.size} speakers, format=${format}`,
  );

  return {
    episodes,
    format: format === 'auto' ? 'paragraphs' : format,
    speakerCount: speakerSet.size,
    speakers: Array.from(speakerSet),
  };
}
