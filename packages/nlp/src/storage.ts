import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { dirname } from 'path';
import type { Sample, AnnotatedSample } from '@codegraph/types';
import { createLogger } from '@codegraph/logger';

const logger = createLogger({ namespace: 'nlp:storage' });

export function loadSamples(path: string): Sample[] {
  logger.debug(`loadSamples: ${path}`);

  if (!existsSync(path)) {
    logger.warn(`File not found: ${path}`);
    return [];
  }

  const content = readFileSync(path, 'utf-8');
  const lines = content.split('\n').filter((line) => line.trim());
  const samples: Sample[] = [];

  for (const line of lines) {
    try {
      samples.push(JSON.parse(line) as Sample);
    } catch (error) {
      logger.error(`Failed to parse line: ${line.slice(0, 100)}`, error);
    }
  }

  logger.debug(`loadSamples returned: ${samples.length} samples`);
  return samples;
}

export function saveSamples(path: string, samples: Sample[]): void {
  logger.debug(`saveSamples: ${path} (${samples.length} samples)`);

  const dir = dirname(path);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }

  const content = samples.map((s) => JSON.stringify(s)).join('\n');
  writeFileSync(path, content + '\n', 'utf-8');

  logger.debug(`saveSamples completed: ${path}`);
}

export function loadAnnotations(path: string): AnnotatedSample[] {
  logger.debug(`loadAnnotations: ${path}`);

  if (!existsSync(path)) {
    logger.warn(`File not found: ${path}`);
    return [];
  }

  const content = readFileSync(path, 'utf-8');
  const lines = content.split('\n').filter((line) => line.trim());
  const annotations: AnnotatedSample[] = [];

  for (const line of lines) {
    try {
      annotations.push(JSON.parse(line) as AnnotatedSample);
    } catch (error) {
      logger.error(`Failed to parse line: ${line.slice(0, 100)}`, error);
    }
  }

  logger.debug(`loadAnnotations returned: ${annotations.length} annotations`);
  return annotations;
}

export function saveAnnotations(path: string, annotations: AnnotatedSample[]): void {
  logger.debug(`saveAnnotations: ${path} (${annotations.length} annotations)`);

  const dir = dirname(path);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }

  const content = annotations.map((a) => JSON.stringify(a)).join('\n');
  writeFileSync(path, content + '\n', 'utf-8');

  logger.debug(`saveAnnotations completed: ${path}`);
}

export function appendSample(path: string, sample: Sample): void {
  logger.debug(`appendSample: ${path} (${sample.id})`);

  const dir = dirname(path);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }

  const line = JSON.stringify(sample) + '\n';
  const existing = existsSync(path) ? readFileSync(path, 'utf-8') : '';
  writeFileSync(path, existing + line, 'utf-8');

  logger.debug(`appendSample completed: ${path}`);
}

export function appendAnnotation(path: string, annotation: AnnotatedSample): void {
  logger.debug(`appendAnnotation: ${path} (${annotation.id})`);

  const dir = dirname(path);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }

  const line = JSON.stringify(annotation) + '\n';
  const existing = existsSync(path) ? readFileSync(path, 'utf-8') : '';
  writeFileSync(path, existing + line, 'utf-8');

  logger.debug(`appendAnnotation completed: ${path}`);
}
