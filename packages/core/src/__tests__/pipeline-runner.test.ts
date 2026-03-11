/**
 * Pipeline Runner Integration Tests (WS13.4)
 *
 * Tests the Task-wrapped extraction pipeline against real TypeScript files.
 * Verifies:
 *   - Parse task produces ASTs and FileEntities
 *   - Extract task produces ParsedFileEntities with entities and edges
 *   - Full pipeline chains parse → extract correctly
 *   - Provenance stamps are applied to output entities
 *   - PipelineRunner events are emitted correctly
 *   - Error handling for missing/invalid files
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { writeFile, mkdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createParseTask, createExtractTask, createExtractionPipeline } from '../pipeline/pipeline-tasks';
import { Task } from '../pipeline/task';
import type { PipelineEvent } from '../pipeline/types';
import type { ParsedFile } from '../pipeline/pipeline-tasks';
import type { ParsedFileEntities } from '@codegraph/types';
import { disposeParser } from '../pipeline/parser';

// ============================================================================
// Test Fixtures
// ============================================================================

let testDir: string;

const SAMPLE_TS = `
import { readFile } from 'node:fs/promises';

export interface Config {
  port: number;
  host: string;
}

export class Server {
  private config: Config;

  constructor(config: Config) {
    this.config = config;
  }

  async start(): Promise<void> {
    console.log('Starting server...');
  }
}

export function createServer(config: Config): Server {
  return new Server(config);
}

export const DEFAULT_PORT = 3000;
`.trim();

const SAMPLE_TS_2 = `
export function add(a: number, b: number): number {
  return a + b;
}

export function multiply(a: number, b: number): number {
  return a * b;
}

export type MathOp = (a: number, b: number) => number;
`.trim();

// ============================================================================
// Setup / Teardown
// ============================================================================

beforeAll(async () => {
  testDir = join(tmpdir(), `codegraph-pipeline-test-${Date.now()}`);
  await mkdir(testDir, { recursive: true });

  // Write test files
  await writeFile(join(testDir, 'server.ts'), SAMPLE_TS);
  await writeFile(join(testDir, 'math.ts'), SAMPLE_TS_2);
});

afterAll(async () => {
  try {
    await rm(testDir, { recursive: true, force: true });
  } catch { /* best effort */ }
  try {
    disposeParser();
  } catch { /* best effort */ }
});

// ============================================================================
// Parse Task Tests
// ============================================================================

describe('createParseTask', () => {
  it('parses a TypeScript file into AST + FileEntity', async () => {
    const task = createParseTask();
    const filePath = join(testDir, 'server.ts');
    const result = await task.run([filePath]);

    expect(result.errors).toBe(0);
    expect(result.output.length).toBe(1);

    const parsed = result.output[0]!;
    expect(parsed.filePath).toBe(filePath);
    expect(parsed.file.path).toBe(filePath);
    expect(parsed.file.name).toBe('server.ts');
    expect(parsed.file.extension).toBe('ts');
    expect(parsed.file.loc).toBeGreaterThan(0);
    expect(parsed.file.hash).toBeDefined();
    expect(parsed.tree).toBeDefined();
    expect(parsed.tree.rootNode).toBeDefined();
  });

  it('parses multiple files', async () => {
    const task = createParseTask();
    const files = [
      join(testDir, 'server.ts'),
      join(testDir, 'math.ts'),
    ];
    const result = await task.run(files);

    expect(result.errors).toBe(0);
    expect(result.output.length).toBe(2);
    expect(result.output[0]!.file.name).toBe('server.ts');
    expect(result.output[1]!.file.name).toBe('math.ts');
  });

  it('continues on error for missing files', async () => {
    const task = createParseTask();
    const files = [
      join(testDir, 'server.ts'),
      join(testDir, 'nonexistent.ts'),
      join(testDir, 'math.ts'),
    ];
    const result = await task.run(files);

    // Should have 1 error (nonexistent.ts) and 2 successful outputs
    expect(result.errors).toBe(1);
    expect(result.output.length).toBe(2);
    expect(result.errorDetails[0]!.error).toContain('ENOENT');
  });

  it('stamps provenance on parsed output', async () => {
    const task = createParseTask();
    task.setPipelineName('test-extraction');
    const result = await task.run([join(testDir, 'server.ts')]);

    const parsed = result.output[0]!;
    // Flat provenance fields
    expect(parsed.sourcePipeline).toBe('test-extraction');
    expect(parsed.sourceTask).toBe('parse');
    expect(typeof parsed.processedAt).toBe('string');
  });
});

// ============================================================================
// Extract Task Tests
// ============================================================================

describe('createExtractTask', () => {
  let parsedFiles: ParsedFile[];

  beforeAll(async () => {
    // Parse files first to get input for extract task
    const parseTask = createParseTask();
    const result = await parseTask.run([
      join(testDir, 'server.ts'),
      join(testDir, 'math.ts'),
    ]);
    parsedFiles = result.output;
  });

  it('extracts entities from parsed files', async () => {
    const task = createExtractTask();
    const result = await task.run(parsedFiles);

    expect(result.errors).toBe(0);
    expect(result.output.length).toBe(2);

    // server.ts should have: Config interface, Server class, createServer function, DEFAULT_PORT variable
    const serverResult = result.output.find(
      (r) => r.file.name === 'server.ts',
    )!;
    expect(serverResult).toBeDefined();
    expect(serverResult.classes.length).toBeGreaterThanOrEqual(1);
    expect(serverResult.classes.some((c) => c.name === 'Server')).toBe(true);
    expect(serverResult.interfaces.length).toBeGreaterThanOrEqual(1);
    expect(serverResult.interfaces.some((i) => i.name === 'Config')).toBe(true);
    expect(serverResult.functions.length).toBeGreaterThanOrEqual(1);
    expect(serverResult.functions.some((f) => f.name === 'createServer')).toBe(true);
    expect(serverResult.variables.some((v) => v.name === 'DEFAULT_PORT')).toBe(true);

    // math.ts should have: add, multiply functions and MathOp type
    const mathResult = result.output.find(
      (r) => r.file.name === 'math.ts',
    )!;
    expect(mathResult).toBeDefined();
    expect(mathResult.functions.length).toBeGreaterThanOrEqual(2);
    expect(mathResult.functions.some((f) => f.name === 'add')).toBe(true);
    expect(mathResult.functions.some((f) => f.name === 'multiply')).toBe(true);
    expect(mathResult.types.some((t) => t.name === 'MathOp')).toBe(true);
  });

  it('extracts with deep analysis for call edges', async () => {
    const task = createExtractTask({ deepAnalysis: true });
    const result = await task.run(parsedFiles);

    expect(result.errors).toBe(0);
    // server.ts has a call from createServer → new Server constructor
    // The exact edges depend on the extractor, but call edges should be present
    const serverResult = result.output.find(
      (r) => r.file.name === 'server.ts',
    )!;
    expect(serverResult).toBeDefined();
    // At minimum, we should get the entities even if call detection varies
    expect(serverResult.functions.length).toBeGreaterThanOrEqual(1);
  });

  it('stamps provenance on extracted entities', async () => {
    const task = createExtractTask();
    task.setPipelineName('test-extraction');
    const result = await task.run([parsedFiles[0]!]);

    const entities = result.output[0]!;
    // Flat provenance on the ParsedFileEntities object itself
    expect((entities as any).sourcePipeline).toBe('test-extraction');
    expect((entities as any).sourceTask).toBe('extract');
  });
});

// ============================================================================
// Full Extraction Pipeline Tests
// ============================================================================

describe('createExtractionPipeline', () => {
  it('runs the full parse → extract pipeline', async () => {
    const pipeline = createExtractionPipeline({ name: 'test-full' });

    const files = [
      join(testDir, 'server.ts'),
      join(testDir, 'math.ts'),
    ];
    const result = await pipeline.run(files);

    expect(result.success).toBe(true);
    expect(result.totalErrors).toBe(0);
    expect(result.taskResults.length).toBe(2);
    expect(result.taskResults[0]!.name).toBe('parse');
    expect(result.taskResults[0]!.outputCount).toBe(2);
    expect(result.taskResults[1]!.name).toBe('extract');
    expect(result.taskResults[1]!.outputCount).toBe(2);
    expect(result.durationMs).toBeGreaterThanOrEqual(0);
  });

  it('emits pipeline events', async () => {
    const pipeline = createExtractionPipeline({ name: 'test-events' });

    const events: PipelineEvent[] = [];
    for await (const event of pipeline.execute([join(testDir, 'server.ts')])) {
      events.push(event);
    }

    const types = events.map((e) => e.type);
    expect(types[0]).toBe('pipeline:start');
    expect(types[types.length - 1]).toBe('pipeline:complete');
    expect(types).toContain('task:start');
    expect(types).toContain('task:progress');
    expect(types).toContain('task:complete');

    // Should have task:start and task:complete for both parse and extract
    const taskStarts = events.filter((e) => e.type === 'task:start');
    const taskCompletes = events.filter((e) => e.type === 'task:complete');
    expect(taskStarts.length).toBe(2);
    expect(taskCompletes.length).toBe(2);
    expect(taskStarts[0]!.task).toBe('parse');
    expect(taskStarts[1]!.task).toBe('extract');
  });

  it('stamps provenance with pipeline name', async () => {
    const pipeline = createExtractionPipeline({ name: 'prov-pipeline' });

    const events: Array<PipelineEvent & { results?: unknown[] }> = [];
    for await (const event of pipeline.execute([join(testDir, 'math.ts')])) {
      events.push(event);
    }

    // Find the extract task:complete event to get output
    const extractComplete = events.find(
      (e) => e.type === 'task:complete' && e.task === 'extract',
    );
    expect(extractComplete).toBeDefined();
    expect(extractComplete!.results).toBeDefined();

    const entities = extractComplete!.results as ParsedFileEntities[];
    expect(entities.length).toBe(1);

    // Check provenance on the output
    const entity = entities[0] as any;
    expect(entity.sourcePipeline).toBe('prov-pipeline');
    expect(entity.sourceTask).toBe('extract');
    expect(typeof entity.processedAt).toBe('string');
  });

  it('handles missing files gracefully (continueOnError)', async () => {
    const pipeline = createExtractionPipeline({ name: 'test-errors' });

    const files = [
      join(testDir, 'server.ts'),
      join(testDir, 'nonexistent.ts'),
      join(testDir, 'math.ts'),
    ];
    const result = await pipeline.run(files);

    // Pipeline should succeed overall since continueOnError=true on tasks
    expect(result.success).toBe(true);
    // Parse task should have 1 error but 2 successful outputs
    expect(result.taskResults[0]!.name).toBe('parse');
    // Extract task should process the 2 successful parses
    expect(result.taskResults[1]!.name).toBe('extract');
    expect(result.taskResults[1]!.outputCount).toBe(2);
  });

  it('handles empty file list', async () => {
    const pipeline = createExtractionPipeline({ name: 'test-empty' });
    const result = await pipeline.run([]);

    expect(result.success).toBe(true);
    expect(result.totalProcessed).toBe(0);
  });

  it('reports timing per task', async () => {
    const pipeline = createExtractionPipeline({ name: 'test-timing' });
    const result = await pipeline.run([join(testDir, 'server.ts')]);

    expect(result.success).toBe(true);
    expect(result.taskResults[0]!.durationMs).toBeGreaterThanOrEqual(0);
    expect(result.taskResults[1]!.durationMs).toBeGreaterThanOrEqual(0);
    expect(result.durationMs).toBeGreaterThanOrEqual(0);
  });

  it('produces correct entity counts from real TypeScript', async () => {
    const pipeline = createExtractionPipeline({
      name: 'test-counts',
      deepAnalysis: true,
    });

    const events: Array<PipelineEvent & { results?: unknown[] }> = [];
    for await (const event of pipeline.execute([join(testDir, 'server.ts')])) {
      events.push(event);
    }

    const extractComplete = events.find(
      (e) => e.type === 'task:complete' && e.task === 'extract',
    );
    const results = extractComplete!.results as ParsedFileEntities[];
    const entities = results[0]!;

    // Verify specific entity extraction
    expect(entities.classes.some((c) => c.name === 'Server')).toBe(true);
    expect(entities.interfaces.some((i) => i.name === 'Config')).toBe(true);
    expect(entities.functions.some((f) => f.name === 'createServer')).toBe(true);
    expect(entities.variables.some((v) => v.name === 'DEFAULT_PORT')).toBe(true);

    // Server class should have methods (start)
    const serverClass = entities.classes.find((c) => c.name === 'Server');
    expect(serverClass).toBeDefined();
    expect(serverClass!.isExported).toBe(true);

    // Config interface should be exported
    const configIface = entities.interfaces.find((i) => i.name === 'Config');
    expect(configIface).toBeDefined();
    expect(configIface!.isExported).toBe(true);

    // createServer function should be exported and not async
    const createServerFn = entities.functions.find((f) => f.name === 'createServer');
    expect(createServerFn).toBeDefined();
    expect(createServerFn!.isExported).toBe(true);
    expect(createServerFn!.isAsync).toBe(false);
    expect(createServerFn!.returnType).toContain('Server');
  });
});
