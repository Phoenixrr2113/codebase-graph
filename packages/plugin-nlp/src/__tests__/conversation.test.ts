/**
 * Conversation Chunking Tests
 *
 * Tests the conversation parser's ability to split various conversation formats
 * into episodes with speaker attribution and temporal ordering.
 */

import { describe, it, expect } from 'vitest';
import { chunkConversation, type Episode } from '../conversation';

// ============================================================================
// Chat-style format
// ============================================================================

describe('Chat-style conversations', () => {
  const chatText = [
    'Alice: We need to refactor the payment module',
    'Bob: I agree, the current implementation has race conditions',
    'Alice: Should we use a queue-based approach?',
    'Charlie: Yes, I think BullMQ would work well here',
    'Bob: Good idea. I can start on the implementation tomorrow',
  ].join('\n');

  it('splits chat messages into episodes', () => {
    const result = chunkConversation(chatText, { format: 'chat' });
    expect(result.episodes.length).toBe(5);
    expect(result.format).toBe('chat');
  });

  it('preserves speaker attribution', () => {
    const result = chunkConversation(chatText, { format: 'chat' });
    expect(result.episodes[0]!.speaker).toBe('Alice');
    expect(result.episodes[1]!.speaker).toBe('Bob');
    expect(result.episodes[3]!.speaker).toBe('Charlie');
  });

  it('detects unique speakers', () => {
    const result = chunkConversation(chatText, { format: 'chat' });
    expect(result.speakerCount).toBe(3);
    expect(result.speakers).toContain('Alice');
    expect(result.speakers).toContain('Bob');
    expect(result.speakers).toContain('Charlie');
  });

  it('preserves message text', () => {
    const result = chunkConversation(chatText, { format: 'chat' });
    expect(result.episodes[0]!.text).toBe('We need to refactor the payment module');
    expect(result.episodes[4]!.text).toBe('Good idea. I can start on the implementation tomorrow');
  });

  it('assigns sequential indexes', () => {
    const result = chunkConversation(chatText, { format: 'chat' });
    for (let i = 0; i < result.episodes.length; i++) {
      expect(result.episodes[i]!.index).toBe(i);
    }
  });

  it('handles multi-line messages', () => {
    const multiLine = [
      'Alice: I found several issues:',
      '  - Race condition in payment flow',
      '  - Missing error handling in retryWithBackoff',
      '  - No tests for edge cases',
      'Bob: Let me take a look at those',
    ].join('\n');

    const result = chunkConversation(multiLine, { format: 'chat' });
    expect(result.episodes.length).toBe(2);
    expect(result.episodes[0]!.text).toContain('Race condition');
    expect(result.episodes[0]!.text).toContain('No tests for edge cases');
  });
});

// ============================================================================
// Timestamped format
// ============================================================================

describe('Timestamped conversations', () => {
  const timestampedText = [
    '[2024-01-15 10:30] Alice: Sprint planning for the payment module',
    '[2024-01-15 10:31] Bob: I think we should prioritize the retry logic',
    '[2024-01-15 10:33] Alice: Agreed. Let me create the tickets',
    '[2024-01-15 10:35] Charlie: Don\'t forget about the monitoring dashboard',
  ].join('\n');

  it('splits timestamped messages into episodes', () => {
    const result = chunkConversation(timestampedText, { format: 'timestamped' });
    expect(result.episodes.length).toBe(4);
    expect(result.format).toBe('timestamped');
  });

  it('preserves speaker attribution', () => {
    const result = chunkConversation(timestampedText, { format: 'timestamped' });
    expect(result.episodes[0]!.speaker).toBe('Alice');
    expect(result.episodes[1]!.speaker).toBe('Bob');
    expect(result.episodes[3]!.speaker).toBe('Charlie');
  });

  it('extracts timestamps', () => {
    const result = chunkConversation(timestampedText, { format: 'timestamped' });
    for (const ep of result.episodes) {
      expect(ep.timestamp).toBeDefined();
    }
  });

  it('handles ISO timestamp format', () => {
    const isoText = [
      '[2024-01-15T10:30:00Z] Alice: First message',
      '[2024-01-15T10:31:00Z] Bob: Second message',
    ].join('\n');

    const result = chunkConversation(isoText, { format: 'timestamped' });
    expect(result.episodes.length).toBe(2);
    expect(result.episodes[0]!.timestamp).toContain('2024');
  });
});

// ============================================================================
// Paragraph-style format
// ============================================================================

describe('Paragraph-style text', () => {
  const paragraphText = [
    'The payment module handles all financial transactions in the system.',
    'It uses a queue-based architecture for reliability.',
    '',
    'The retry logic is implemented using exponential backoff.',
    'When a payment fails, it will retry up to 3 times before flagging for manual review.',
    '',
    'We decided to use BullMQ for the job queue after evaluating several alternatives.',
    'The main factors were reliability, Redis compatibility, and the TypeScript-first API.',
  ].join('\n');

  it('splits on double newlines', () => {
    const result = chunkConversation(paragraphText, { format: 'paragraphs' });
    expect(result.episodes.length).toBe(3);
    expect(result.format).toBe('paragraphs');
  });

  it('has no speaker attribution', () => {
    const result = chunkConversation(paragraphText, { format: 'paragraphs' });
    expect(result.speakerCount).toBe(0);
    for (const ep of result.episodes) {
      expect(ep.speaker).toBeUndefined();
    }
  });

  it('preserves paragraph text', () => {
    const result = chunkConversation(paragraphText, { format: 'paragraphs' });
    expect(result.episodes[0]!.text).toContain('queue-based architecture');
    expect(result.episodes[2]!.text).toContain('BullMQ');
  });
});

// ============================================================================
// Auto-detection
// ============================================================================

describe('Auto-detection', () => {
  it('auto-detects chat format', () => {
    const chatText = [
      'Alice: Hello team, welcome to the meeting',
      'Bob: Hi Alice, thanks for setting this up',
      'Charlie: Hey everyone, glad to be here',
      'Alice: Great, let us get started now',
    ].join('\n');

    const result = chunkConversation(chatText); // format: 'auto' by default
    expect(result.format).toBe('chat');
    expect(result.episodes.length).toBe(4);
  });

  it('auto-detects timestamped format', () => {
    const tsText = [
      '[10:30] Alice: Hello',
      '[10:31] Bob: Hi',
      '[10:32] Charlie: Hey',
    ].join('\n');

    const result = chunkConversation(tsText);
    expect(result.format).toBe('timestamped');
  });

  it('defaults to paragraphs for unstructured text', () => {
    const unstructured = [
      'The system has several components.',
      '',
      'Each component handles specific responsibilities.',
    ].join('\n');

    const result = chunkConversation(unstructured);
    expect(result.format).toBe('paragraphs');
  });
});

// ============================================================================
// Edge cases
// ============================================================================

describe('Edge cases', () => {
  it('rejects an adversarial timestamp-shaped line within a bounded time', () => {
    const text = '[\\] ' + '  '.repeat(40_000) + 'x';
    const startedAt = performance.now();

    const result = chunkConversation(text);

    expect(performance.now() - startedAt).toBeLessThan(250);
    expect(result.format).toBe('paragraphs');
    expect(result.episodes).toHaveLength(1);
  });

  it('handles empty input', () => {
    const result = chunkConversation('');
    expect(result.episodes.length).toBe(0);
  });

  it('handles single line input', () => {
    const result = chunkConversation('Alice: Just one message here');
    expect(result.episodes.length).toBe(1);
  });

  it('filters out very short episodes', () => {
    const text = [
      'Alice: Hello',
      '',
      'Bob: Hi',
      '',
      'Alice: Let me explain the architecture in detail. The system uses a microservices approach with event sourcing.',
    ].join('\n');

    // With minEpisodeLength=10, "Hello" and "Hi" might be too short
    // depending on format detection
    const result = chunkConversation(text, { minEpisodeLength: 20 });
    // Only the last message should survive the filter
    for (const ep of result.episodes) {
      expect(ep.text.length).toBeGreaterThanOrEqual(20);
    }
  });

  it('splits long episodes', () => {
    const longMessage = 'A'.repeat(1000) + '. ' + 'B'.repeat(1000) + '. ' + 'C'.repeat(1000);
    const text = `Alice: ${longMessage}`;

    const result = chunkConversation(text, { format: 'chat', maxEpisodeLength: 1500 });
    expect(result.episodes.length).toBeGreaterThan(1);
    // All episodes should respect the max length
    for (const ep of result.episodes) {
      expect(ep.text.length).toBeLessThanOrEqual(1500);
    }
    // Speaker should be preserved on all sub-episodes
    for (const ep of result.episodes) {
      expect(ep.speaker).toBe('Alice');
    }
  });

  it('handles speaker names with dots and apostrophes', () => {
    const text = [
      "Dr. Smith: The patient's records show improvement",
      "O'Brien: I concur with Dr. Smith's assessment",
    ].join('\n');

    const result = chunkConversation(text, { format: 'chat' });
    expect(result.episodes.length).toBe(2);
    expect(result.episodes[0]!.speaker).toBe('Dr. Smith');
    expect(result.episodes[1]!.speaker).toBe("O'Brien");
  });

  it('preserves whitespace-only lines as paragraph separators', () => {
    const text = 'First paragraph.\n   \nSecond paragraph.';
    const result = chunkConversation(text, { format: 'paragraphs' });
    expect(result.episodes.length).toBe(2);
  });
});
