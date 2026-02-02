import { readFileSync, existsSync } from 'fs';
import type { Sample } from '@codegraph/types';
import { createLogger } from '@codegraph/logger';
import { randomUUID } from 'crypto';

const logger = createLogger({ namespace: 'nlp:importers' });

export type MessageInput = {
  id?: string;
  text: string;
  source?: string;
  context?: string;
  timestamp?: string;
  metadata?: Record<string, unknown>;
};

export function createSample(input: MessageInput): Sample {
  const sample: Sample = {
    id: input.id ?? randomUUID(),
    text: input.text.trim(),
    createdAt: new Date().toISOString(),
  };
  if (input.source !== undefined) sample.source = input.source;
  if (input.context !== undefined) sample.context = input.context;
  if (input.timestamp !== undefined) sample.timestamp = input.timestamp;
  if (input.metadata !== undefined) sample.metadata = input.metadata;
  return sample;
}

export function createSamplesFromStrings(
  texts: string[],
  source: string = 'manual'
): Sample[] {
  return texts
    .map((text) => text.trim())
    .filter((text) => text.length > 0)
    .map((text) => createSample({ text, source }));
}

export function createSamplesFromJsonl(path: string): Sample[] {
  logger.debug(`createSamplesFromJsonl: ${path}`);

  if (!existsSync(path)) {
    logger.error(`File not found: ${path}`);
    return [];
  }

  const content = readFileSync(path, 'utf-8');
  const lines = content.split('\n').filter((line) => line.trim());
  const samples: Sample[] = [];

  for (const line of lines) {
    try {
      const data = JSON.parse(line) as MessageInput;
      if (data.text) {
        samples.push(createSample({ ...data, source: data.source ?? 'jsonl' }));
      }
    } catch (error) {
      logger.warn(`Failed to parse JSONL line: ${line.slice(0, 100)}`);
    }
  }

  logger.debug(`createSamplesFromJsonl: loaded ${samples.length} samples`);
  return samples;
}

export function createSamplesFromJson(path: string, textField: string = 'text'): Sample[] {
  logger.debug(`createSamplesFromJson: ${path}, field=${textField}`);

  if (!existsSync(path)) {
    logger.error(`File not found: ${path}`);
    return [];
  }

  const content = readFileSync(path, 'utf-8');

  try {
    const data = JSON.parse(content) as unknown;

    if (Array.isArray(data)) {
      return data
        .filter((item): item is Record<string, unknown> => typeof item === 'object' && item !== null)
        .filter((item) => typeof item[textField] === 'string')
        .map((item) =>
          createSample({
            text: item[textField] as string,
            source: 'json',
            metadata: item,
          })
        );
    }

    logger.warn('JSON file is not an array');
    return [];
  } catch (error) {
    logger.error(`Failed to parse JSON: ${path}`, error);
    return [];
  }
}

export function filterByLength(samples: Sample[], minLength: number = 50): Sample[] {
  logger.debug(`filterByLength: ${samples.length} samples, minLength=${minLength}`);
  const filtered = samples.filter((s) => s.text.length >= minLength);
  logger.debug(`filterByLength returned: ${filtered.length} samples`);
  return filtered;
}

export function filterByMetadata(
  samples: Sample[],
  key: string,
  value: unknown
): Sample[] {
  logger.debug(`filterByMetadata: ${samples.length} samples, ${key}=${value}`);
  const filtered = samples.filter((s) => s.metadata?.[key] === value);
  logger.debug(`filterByMetadata returned: ${filtered.length} samples`);
  return filtered;
}
