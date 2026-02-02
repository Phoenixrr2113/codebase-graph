import { readFileSync, existsSync } from 'fs';
import type { Sample } from '@codegraph/types';
import { createLogger } from '@codegraph/logger';
import { randomUUID } from 'crypto';

const logger = createLogger({ namespace: 'nlp:claude-importer' });

export type ClaudeExport = {
  uuid: string;
  name: string;
  created_at: string;
  updated_at: string;
  chat_messages: ClaudeMessage[];
};

export type ClaudeMessage = {
  uuid: string;
  text: string;
  sender: 'human' | 'assistant';
  created_at: string;
  updated_at: string;
  attachments?: unknown[];
};

export function parseClaudeExport(jsonPath: string): Sample[] {
  logger.debug(`parseClaudeExport: ${jsonPath}`);

  if (!existsSync(jsonPath)) {
    logger.error(`File not found: ${jsonPath}`);
    return [];
  }

  const content = readFileSync(jsonPath, 'utf-8');
  const exports = JSON.parse(content) as ClaudeExport[];

  const samples: Sample[] = [];

  for (const conversation of exports) {
    for (const message of conversation.chat_messages) {
      if (message.text && message.text.trim().length > 10) {
        samples.push({
          id: randomUUID(),
          source: 'claude',
          sourceFile: jsonPath,
          text: message.text.trim(),
          context: conversation.name,
          metadata: {
            conversationId: conversation.uuid,
            messageId: message.uuid,
            sender: message.sender,
            createdAt: message.created_at,
          },
          createdAt: message.created_at,
        });
      }
    }
  }

  logger.debug(`parseClaudeExport returned: ${samples.length} samples`);
  return samples;
}

export function filterHumanMessages(samples: Sample[]): Sample[] {
  logger.debug(`filterHumanMessages: ${samples.length} samples`);
  const filtered = samples.filter((s) => s.metadata?.sender === 'human');
  logger.debug(`filterHumanMessages returned: ${filtered.length} samples`);
  return filtered;
}

export function filterByMinLength(samples: Sample[], minLength: number = 50): Sample[] {
  logger.debug(`filterByMinLength: ${samples.length} samples, minLength=${minLength}`);
  const filtered = samples.filter((s) => s.text.length >= minLength);
  logger.debug(`filterByMinLength returned: ${filtered.length} samples`);
  return filtered;
}
