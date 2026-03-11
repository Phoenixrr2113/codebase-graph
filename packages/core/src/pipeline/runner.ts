/**
 * Pipeline Runner
 *
 * Chains multiple Tasks in sequence, feeding the output of each
 * task as input to the next. Provides progress reporting and
 * optional incremental processing (skip unchanged files).
 *
 * Usage:
 *   const pipeline = new PipelineRunner({
 *     name: 'extract',
 *     tasks: [parseTask, extractTask, storeTask],
 *   });
 *
 *   const result = await pipeline.run(filePaths);
 *   // or stream events:
 *   for await (const event of pipeline.execute(filePaths)) { ... }
 */

import { createHash } from 'node:crypto';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { createLogger } from '@codegraph/logger';
import { Task } from './task';
import type {
  PipelineEvent,
  PipelineRunConfig,
  IncrementalState,
} from './types';

const logger = createLogger({ namespace: 'core:pipeline:runner' });

// ============================================================================
// Pipeline Result
// ============================================================================

export interface PipelineResult {
  /** Pipeline name */
  name: string;
  /** Whether the pipeline completed successfully */
  success: boolean;
  /** Total duration in ms */
  durationMs: number;
  /** Per-task results */
  taskResults: Array<{
    name: string;
    outputCount: number;
    errors: number;
    durationMs: number;
  }>;
  /** Total items processed */
  totalProcessed: number;
  /** Total errors across all tasks */
  totalErrors: number;
  /** Items skipped (incremental mode) */
  skipped: number;
}

// ============================================================================
// Pipeline Runner
// ============================================================================

export class PipelineRunner {
  readonly name: string;
  private readonly tasks: Task[];
  private readonly incremental: boolean;
  private readonly stateDir: string;

  constructor(config: PipelineRunConfig & { tasks: Task[] }) {
    this.name = config.name;
    this.tasks = config.tasks;
    this.incremental = config.incremental ?? false;
    this.stateDir = config.stateDir ?? '.codegraph/pipeline-state';

    // Set pipeline name on all tasks for provenance
    for (const task of this.tasks) {
      task.setPipelineName(this.name);
    }
  }

  /**
   * Execute the pipeline, yielding events for progress tracking.
   */
  async *execute(initialInput: unknown[]): AsyncGenerator<PipelineEvent> {
    const startTime = Date.now();
    let input = initialInput;
    let skipped = 0;

    yield {
      type: 'pipeline:start',
      timestamp: new Date().toISOString(),
      total: input.length,
    };

    // Incremental: filter out unchanged items
    if (this.incremental) {
      const state = await this.loadState();
      const filtered: unknown[] = [];

      for (const item of input) {
        const key = this.getItemKey(item);
        const hash = this.getItemHash(item);
        const existing = state[key];

        if (existing && existing.hash === hash) {
          skipped++;
          continue;
        }
        filtered.push(item);
      }

      if (skipped > 0) {
        logger.info(`Incremental: skipping ${skipped} unchanged items`);
      }
      input = filtered;
    }

    // Chain tasks: output of each becomes input for the next
    for (const task of this.tasks) {
      if (input.length === 0) {
        logger.info(`Task ${task.name}: skipping (no input)`);

        yield {
          type: 'task:complete',
          task: task.name,
          timestamp: new Date().toISOString(),
          processed: 0,
          total: 0,
          outputCount: 0,
          durationMs: 0,
        };
        continue;
      }

      let taskOutput: unknown[] = [];

      for await (const event of task.execute(input as never[])) {
        yield event;

        if (event.type === 'task:complete' && event.results) {
          // Flatten if output is array of arrays
          taskOutput = event.results as unknown[];
        }
        if (event.type === 'task:error') {
          // If a task aborts, pipeline stops
          yield {
            type: 'pipeline:complete',
            timestamp: new Date().toISOString(),
            durationMs: Date.now() - startTime,
            error: `Pipeline aborted: task ${task.name} failed: ${event.error}`,
          };
          return;
        }
      }

      // Feed output as input to next task
      input = taskOutput;
    }

    // Update incremental state
    if (this.incremental) {
      await this.updateState(initialInput);
    }

    const durationMs = Date.now() - startTime;
    logger.info(`Pipeline ${this.name} complete: ${durationMs}ms, ${skipped} skipped`);

    yield {
      type: 'pipeline:complete',
      timestamp: new Date().toISOString(),
      durationMs,
      processed: initialInput.length - skipped,
      total: initialInput.length,
    };
  }

  /**
   * Run the pipeline and return a collected result.
   */
  async run(initialInput: unknown[]): Promise<PipelineResult> {
    const taskResults: PipelineResult['taskResults'] = [];
    let durationMs = 0;
    let totalProcessed = 0;
    let totalErrors = 0;
    let skipped = 0;
    let success = true;

    for await (const event of this.execute(initialInput)) {
      if (event.type === 'task:complete') {
        taskResults.push({
          name: event.task ?? 'unknown',
          outputCount: event.outputCount ?? 0,
          errors: 0, // errors tracked separately
          durationMs: event.durationMs ?? 0,
        });
      }
      if (event.type === 'item:error') {
        totalErrors++;
        const lastTask = taskResults[taskResults.length - 1];
        if (lastTask) lastTask.errors++;
      }
      if (event.type === 'task:error') {
        totalErrors++;
        success = false;
      }
      if (event.type === 'pipeline:complete') {
        durationMs = event.durationMs ?? 0;
        totalProcessed = event.processed ?? 0;
        if (event.error) success = false;
        skipped = (event.total ?? 0) - totalProcessed;
      }
    }

    return {
      name: this.name,
      success,
      durationMs,
      taskResults,
      totalProcessed,
      totalErrors,
      skipped,
    };
  }

  // ===========================================================================
  // Incremental State Management
  // ===========================================================================

  private async loadState(): Promise<IncrementalState> {
    try {
      const statePath = join(this.stateDir, `${this.name}.json`);
      const content = await readFile(statePath, 'utf-8');
      return JSON.parse(content) as IncrementalState;
    } catch {
      return {};
    }
  }

  private async updateState(items: unknown[]): Promise<void> {
    try {
      const state = await this.loadState();
      const now = new Date().toISOString();

      for (const item of items) {
        const key = this.getItemKey(item);
        state[key] = {
          hash: this.getItemHash(item),
          processedAt: now,
          pipeline: this.name,
        };
      }

      await mkdir(this.stateDir, { recursive: true });
      const statePath = join(this.stateDir, `${this.name}.json`);
      await writeFile(statePath, JSON.stringify(state, null, 2));
    } catch (error) {
      logger.warn('Failed to save incremental state', error);
    }
  }

  /**
   * Get a unique key for an item (for incremental tracking).
   * Handles strings (file paths) and objects with path/name/id.
   */
  private getItemKey(item: unknown): string {
    if (typeof item === 'string') return item;
    if (item && typeof item === 'object') {
      const obj = item as Record<string, unknown>;
      return String(obj['filePath'] ?? obj['path'] ?? obj['name'] ?? obj['id'] ?? JSON.stringify(item));
    }
    return String(item);
  }

  /**
   * Get a content hash for an item (for change detection).
   */
  private getItemHash(item: unknown): string {
    const content = typeof item === 'string' ? item : JSON.stringify(item);
    return createHash('md5').update(content).digest('hex');
  }
}
