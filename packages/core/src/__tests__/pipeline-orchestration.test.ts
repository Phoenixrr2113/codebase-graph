/**
 * Pipeline Orchestration — Unit Tests
 *
 * Tests the Task wrapper, PipelineRunner, provenance stamping,
 * error handling, and incremental processing.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Task } from '../pipeline/task';
import { PipelineRunner } from '../pipeline/runner';
import type { PipelineEvent, Provenanceable } from '../pipeline/types';

// ============================================================================
// Task Wrapper Tests
// ============================================================================

describe('Task', () => {
  it('should process a batch of items', async () => {
    const task = new Task<number, number>({
      name: 'double',
      process: async (items) => items.map((n) => n * 2),
    });

    const result = await task.run([1, 2, 3, 4, 5]);

    expect(result.output).toEqual([2, 4, 6, 8, 10]);
    expect(result.errors).toBe(0);
    expect(result.durationMs).toBeGreaterThanOrEqual(0);
  });

  it('should process items individually when itemLevel=true', async () => {
    const processFn = vi.fn(async (n: number) => n * 3);

    const task = new Task<number, number>({
      name: 'triple',
      itemLevel: true,
      process: processFn,
    });

    const result = await task.run([10, 20, 30]);

    expect(result.output).toEqual([30, 60, 90]);
    expect(processFn).toHaveBeenCalledTimes(3);
  });

  it('should respect batchSize', async () => {
    const batchSizes: number[] = [];

    const task = new Task<number, number>({
      name: 'counted',
      batchSize: 3,
      process: async (items) => {
        batchSizes.push(items.length);
        return items;
      },
    });

    await task.run([1, 2, 3, 4, 5, 6, 7]);

    // Should have 3 batches: [1,2,3], [4,5,6], [7]
    expect(batchSizes).toEqual([3, 3, 1]);
  });

  it('should yield progress events', async () => {
    const task = new Task<number, number>({
      name: 'progress-test',
      batchSize: 2,
      process: async (items) => items,
    });

    const events: PipelineEvent[] = [];
    for await (const event of task.execute([1, 2, 3, 4, 5])) {
      events.push(event);
    }

    // Should have: start, progress x3 (batches 2,2,1), complete
    const types = events.map((e) => e.type);
    expect(types[0]).toBe('task:start');
    expect(types[types.length - 1]).toBe('task:complete');
    expect(types.filter((t) => t === 'task:progress').length).toBe(3);

    // Start event should have total
    expect(events[0].total).toBe(5);

    // Complete event should have final stats
    const complete = events[events.length - 1];
    expect(complete.processed).toBe(5);
    expect(complete.outputCount).toBe(5);
    expect(complete.durationMs).toBeGreaterThanOrEqual(0);
  });

  it('should abort on error by default', async () => {
    const task = new Task<number, number>({
      name: 'abort-test',
      batchSize: 2,
      process: async (items) => {
        if (items.includes(3)) throw new Error('Cannot process 3');
        return items;
      },
    });

    const events: PipelineEvent[] = [];
    for await (const event of task.execute([1, 2, 3, 4])) {
      events.push(event);
    }

    // Should abort after the error
    const types = events.map((e) => e.type);
    expect(types).toContain('task:error');
    expect(types).not.toContain('task:complete');
  });

  it('should continue on error when continueOnError=true', async () => {
    const task = new Task<number, number>({
      name: 'continue-test',
      batchSize: 1,
      itemLevel: true,
      continueOnError: true,
      process: async (n) => {
        if (n === 3) throw new Error('Bad number');
        return n * 2;
      },
    });

    const result = await task.run([1, 2, 3, 4, 5]);

    expect(result.output).toEqual([2, 4, 8, 10]); // 3 skipped
    expect(result.errors).toBe(1);
    expect(result.errorDetails[0].error).toBe('Bad number');
  });

  it('should stamp provenance on output items', async () => {
    interface Item extends Record<string, unknown> {
      value: number;
    }

    const task = new Task<number, Item>({
      name: 'stamper',
      process: async (items) => items.map((n) => ({ value: n })),
    });
    task.setPipelineName('test-pipeline');

    const result = await task.run([1, 2, 3]);

    for (const item of result.output) {
      const prov = (item as unknown as Provenanceable)._provenance;
      expect(prov).toBeDefined();
      expect(prov!.sourcePipeline).toBe('test-pipeline');
      expect(prov!.sourceTask).toBe('stamper');
      expect(prov!.processedAt).toBeDefined();
    }
  });

  it('should stamp flat provenance fields for graph persistence', async () => {
    interface Item extends Record<string, unknown> {
      value: number;
    }

    const task = new Task<number, Item>({
      name: 'flat-stamper',
      process: async (items) => items.map((n) => ({ value: n })),
    });
    task.setPipelineName('my-pipeline');

    const result = await task.run([42]);

    const item = result.output[0]!;
    // Flat fields should be directly on the object (for graph entity types)
    expect(item['sourcePipeline']).toBe('my-pipeline');
    expect(item['sourceTask']).toBe('flat-stamper');
    expect(typeof item['processedAt']).toBe('string');
    // Nested _provenance should also be present
    const prov = (item as unknown as Provenanceable)._provenance;
    expect(prov).toBeDefined();
    expect(prov!.sourcePipeline).toBe(item['sourcePipeline']);
    expect(prov!.sourceTask).toBe(item['sourceTask']);
  });

  it('should not stamp provenance when disabled', async () => {
    const task = new Task<number, Record<string, unknown>>({
      name: 'no-stamp',
      process: async (items) => items.map((n) => ({ value: n })),
    });

    const result = await task.run([1], { stampProvenance: false });
    const prov = (result.output[0] as Provenanceable)._provenance;
    expect(prov).toBeUndefined();
  });

  it('should handle empty input', async () => {
    const task = new Task<number, number>({
      name: 'empty',
      process: async (items) => items,
    });

    const result = await task.run([]);

    expect(result.output).toEqual([]);
    expect(result.errors).toBe(0);
  });
});

// ============================================================================
// PipelineRunner Tests
// ============================================================================

describe('PipelineRunner', () => {
  it('should chain two tasks', async () => {
    const doubleTask = new Task<number, number>({
      name: 'double',
      process: async (items) => items.map((n) => n * 2),
    });

    const addTenTask = new Task<number, number>({
      name: 'addTen',
      process: async (items) => items.map((n) => n + 10),
    });

    const pipeline = new PipelineRunner({
      name: 'test-pipeline',
      tasks: [doubleTask, addTenTask],
    });

    const result = await pipeline.run([1, 2, 3]);

    expect(result.success).toBe(true);
    expect(result.totalErrors).toBe(0);
    expect(result.taskResults.length).toBe(2);
    expect(result.taskResults[0].name).toBe('double');
    expect(result.taskResults[1].name).toBe('addTen');
    expect(result.durationMs).toBeGreaterThanOrEqual(0);
  });

  it('should yield pipeline events', async () => {
    const taskA = new Task<number, number>({
      name: 'taskA',
      process: async (items) => items.map((n) => n + 1),
    });

    const taskB = new Task<number, string>({
      name: 'taskB',
      process: async (items) => items.map((n) => `result-${n}`),
    });

    const pipeline = new PipelineRunner({
      name: 'event-test',
      tasks: [taskA, taskB],
    });

    const events: PipelineEvent[] = [];
    for await (const event of pipeline.execute([1, 2])) {
      events.push(event);
    }

    const types = events.map((e) => e.type);
    expect(types[0]).toBe('pipeline:start');
    expect(types[types.length - 1]).toBe('pipeline:complete');
    expect(types).toContain('task:start');
    expect(types).toContain('task:progress');
    expect(types).toContain('task:complete');
  });

  it('should abort pipeline on task error', async () => {
    const failTask = new Task<number, number>({
      name: 'fail',
      process: async () => {
        throw new Error('Task failed');
      },
    });

    const neverTask = new Task<number, number>({
      name: 'never',
      process: async (items) => items,
    });

    const pipeline = new PipelineRunner({
      name: 'abort-test',
      tasks: [failTask, neverTask],
    });

    const result = await pipeline.run([1, 2, 3]);

    expect(result.success).toBe(false);
    expect(result.totalErrors).toBeGreaterThan(0);
  });

  it('should handle empty input', async () => {
    const task = new Task<number, number>({
      name: 'noop',
      process: async (items) => items,
    });

    const pipeline = new PipelineRunner({
      name: 'empty-test',
      tasks: [task],
    });

    const result = await pipeline.run([]);

    expect(result.success).toBe(true);
    expect(result.totalProcessed).toBe(0);
  });

  it('should skip subsequent tasks when first produces no output', async () => {
    const filterTask = new Task<number, number>({
      name: 'filter',
      process: async (items) => items.filter((n) => n > 100), // nothing passes
    });

    const processTask = new Task<number, string>({
      name: 'process',
      process: async (items) => items.map((n) => `v${n}`),
    });

    const pipeline = new PipelineRunner({
      name: 'skip-test',
      tasks: [filterTask, processTask],
    });

    const result = await pipeline.run([1, 2, 3]);

    expect(result.success).toBe(true);
    // Both tasks should have completed
    expect(result.taskResults.length).toBe(2);
    // Second task should have 0 output
    expect(result.taskResults[1].outputCount).toBe(0);
  });

  it('should stamp provenance with pipeline name', async () => {
    interface Item extends Record<string, unknown> {
      value: number;
    }

    const task = new Task<number, Item>({
      name: 'create',
      process: async (items) => items.map((n) => ({ value: n })),
    });

    const pipeline = new PipelineRunner({
      name: 'provenance-test',
      tasks: [task],
    });

    // Collect the output via events
    const events: Array<PipelineEvent & { results?: unknown[] }> = [];
    for await (const event of pipeline.execute([42])) {
      events.push(event);
    }

    const completeEvent = events.find(
      (e) => e.type === 'task:complete' && e.task === 'create',
    );
    expect(completeEvent).toBeDefined();
    const output = completeEvent!.results as Item[];
    expect(output).toBeDefined();
    expect(output.length).toBe(1);

    const prov = (output[0] as unknown as Provenanceable)._provenance;
    expect(prov).toBeDefined();
    expect(prov!.sourcePipeline).toBe('provenance-test');
    expect(prov!.sourceTask).toBe('create');
  });

  it('should report timing per task', async () => {
    const slowTask = new Task<number, number>({
      name: 'slow',
      process: async (items) => {
        await new Promise((r) => setTimeout(r, 50));
        return items;
      },
    });

    const fastTask = new Task<number, number>({
      name: 'fast',
      process: async (items) => items,
    });

    const pipeline = new PipelineRunner({
      name: 'timing-test',
      tasks: [slowTask, fastTask],
    });

    const result = await pipeline.run([1, 2, 3]);

    expect(result.success).toBe(true);
    expect(result.taskResults[0].durationMs).toBeGreaterThanOrEqual(40);
    expect(result.durationMs).toBeGreaterThanOrEqual(40);
  });
});

// ============================================================================
// Integration: Multi-step pipeline simulation
// ============================================================================

describe('Pipeline — multi-step simulation', () => {
  it('should simulate parse → extract → store pipeline', async () => {
    // Simulated types
    interface FileInput {
      path: string;
      content: string;
    }
    interface ParsedFile {
      path: string;
      functions: string[];
    }
    interface StoredResult {
      path: string;
      storedCount: number;
    }

    // Step 1: "Parse" files (extract function names from content)
    const parseTask = new Task<FileInput, ParsedFile>({
      name: 'parse',
      itemLevel: true,
      process: async (file) => ({
        path: file.path,
        functions: file.content.match(/function (\w+)/g)?.map((m) => m.replace('function ', '')) ?? [],
      }),
    });

    // Step 2: "Store" parsed results
    const storeTask = new Task<ParsedFile, StoredResult>({
      name: 'store',
      itemLevel: true,
      process: async (parsed) => ({
        path: parsed.path,
        storedCount: parsed.functions.length,
      }),
    });

    const pipeline = new PipelineRunner({
      name: 'extract',
      tasks: [parseTask, storeTask],
    });

    const files: FileInput[] = [
      { path: 'a.ts', content: 'function foo() {} function bar() {}' },
      { path: 'b.ts', content: 'function baz() {}' },
      { path: 'c.ts', content: 'const x = 1;' }, // no functions
    ];

    const result = await pipeline.run(files);

    expect(result.success).toBe(true);
    expect(result.taskResults[0].name).toBe('parse');
    expect(result.taskResults[0].outputCount).toBe(3);
    expect(result.taskResults[1].name).toBe('store');
    expect(result.taskResults[1].outputCount).toBe(3);
    expect(result.totalErrors).toBe(0);
  });
});
