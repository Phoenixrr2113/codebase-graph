/**
 * Pipeline Task Wrapper
 *
 * Wraps any async processing function in a uniform interface with:
 *   - Batch buffering (configurable batch size)
 *   - Per-item error handling (continue on error)
 *   - Provenance stamping (auto-stamps output with source task/pipeline)
 *   - Progress events via AsyncGenerator
 *
 * Usage:
 *   const parseTask = new Task({
 *     name: 'parse',
 *     batchSize: 10,
 *     process: async (files: string[]) => files.map(f => parseFile(f)),
 *   });
 *
 *   for await (const event of parseTask.execute(files)) {
 *     if (event.type === 'task:progress') console.log(`${event.processed}/${event.total}`);
 *   }
 */

import { createLogger } from '@codegraph/logger';
import type {
  TaskConfig,
  PipelineEvent,
  ProvenanceMetadata,
  Provenanceable,
} from './types';

const logger = createLogger({ namespace: 'core:pipeline:task' });

// ============================================================================
// Task Result — collected after execution
// ============================================================================

export interface TaskResult<TOut> {
  /** Successfully processed output items */
  output: TOut[];
  /** Number of errors encountered */
  errors: number;
  /** Error details */
  errorDetails: Array<{ item: unknown; error: string }>;
  /** Duration in ms */
  durationMs: number;
}

// ============================================================================
// Task Class
// ============================================================================

export class Task<TIn = unknown, TOut = unknown> {
  readonly name: string;
  readonly description: string;
  readonly batchSize: number;
  readonly continueOnError: boolean;
  private readonly _process: TaskConfig<TIn, TOut>['process'];
  private readonly _itemLevel: boolean;
  private _pipelineName: string = 'default';

  constructor(config: TaskConfig<TIn, TOut>) {
    this.name = config.name;
    this.description = config.description ?? config.name;
    this.batchSize = config.batchSize ?? 50;
    this.continueOnError = config.continueOnError ?? false;
    this._process = config.process;
    this._itemLevel = config.itemLevel ?? false;
  }

  /** Set the pipeline name for provenance stamping */
  setPipelineName(name: string): void {
    this._pipelineName = name;
  }

  /**
   * Execute the task on an array of input items.
   * Yields PipelineEvents for progress tracking.
   * Returns final results via the TaskResult collected from events.
   */
  async *execute(
    items: TIn[],
    options?: { stampProvenance?: boolean },
  ): AsyncGenerator<PipelineEvent & { results?: TOut[] }> {
    const startTime = Date.now();
    const total = items.length;
    const allOutput: TOut[] = [];
    const errorDetails: Array<{ item: unknown; error: string }> = [];
    let processed = 0;

    yield {
      type: 'task:start',
      task: this.name,
      timestamp: new Date().toISOString(),
      total,
    };

    // Process in batches
    for (let i = 0; i < items.length; i += this.batchSize) {
      const batch = items.slice(i, i + this.batchSize);
      let batchOutput: TOut[];

      try {
        if (this._itemLevel) {
          // Process each item individually
          batchOutput = [];
          for (const item of batch) {
            try {
              const itemFn = this._process as (item: TIn) => Promise<TOut>;
              const result = await itemFn(item);
              batchOutput.push(result);
            } catch (error) {
              const msg = error instanceof Error ? error.message : String(error);
              if (this.continueOnError) {
                logger.warn(`Task ${this.name}: item error (continuing): ${msg}`);
                errorDetails.push({ item, error: msg });

                yield {
                  type: 'item:error' as const,
                  task: this.name,
                  timestamp: new Date().toISOString(),
                  error: msg,
                  errorItem: item,
                  processed: processed + batch.indexOf(item) + 1,
                  total,
                };
              } else {
                throw error;
              }
            }
          }
        } else {
          // Process the whole batch
          const batchFn = this._process as (items: TIn[]) => Promise<TOut[]>;
          batchOutput = await batchFn(batch);
        }

        // Optional: stamp provenance on output items
        if (options?.stampProvenance !== false) {
          this.stampBatch(batchOutput);
        }

        allOutput.push(...batchOutput);
        processed += batch.length;

        yield {
          type: 'task:progress',
          task: this.name,
          timestamp: new Date().toISOString(),
          processed,
          total,
          outputCount: batchOutput.length,
        };
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        logger.error(`Task ${this.name}: batch error: ${msg}`);

        if (this.continueOnError) {
          errorDetails.push({ item: batch, error: msg });
          processed += batch.length;

          yield {
            type: 'item:error',
            task: this.name,
            timestamp: new Date().toISOString(),
            error: msg,
            errorItem: batch,
            processed,
            total,
          };
        } else {
          yield {
            type: 'task:error',
            task: this.name,
            timestamp: new Date().toISOString(),
            error: msg,
            processed,
            total,
          };
          return; // Abort on error
        }
      }
    }

    const durationMs = Date.now() - startTime;

    logger.info(
      `Task ${this.name} complete: ${allOutput.length} results, ${errorDetails.length} errors, ${durationMs}ms`,
    );

    yield {
      type: 'task:complete',
      task: this.name,
      timestamp: new Date().toISOString(),
      processed,
      total,
      outputCount: allOutput.length,
      durationMs,
      results: allOutput,
    };
  }

  /**
   * Execute and collect all results (convenience method).
   * Returns a TaskResult with all output items and error info.
   */
  async run(
    items: TIn[],
    options?: { stampProvenance?: boolean },
  ): Promise<TaskResult<TOut>> {
    let output: TOut[] = [];
    const errorDetails: Array<{ item: unknown; error: string }> = [];
    let durationMs = 0;

    for await (const event of this.execute(items, options)) {
      if (event.type === 'task:complete') {
        output = event.results ?? [];
        durationMs = event.durationMs ?? 0;
      }
      if (event.type === 'item:error' || event.type === 'task:error') {
        errorDetails.push({
          item: event.errorItem,
          error: event.error ?? 'Unknown error',
        });
      }
    }

    return {
      output,
      errors: errorDetails.length,
      errorDetails,
      durationMs,
    };
  }

  /**
   * Stamp provenance metadata on output items (if they are objects).
   * Sets both the `_provenance` metadata object and flat provenance fields
   * (`sourcePipeline`, `sourceTask`, `processedAt`) for direct graph persistence.
   */
  private stampBatch(items: TOut[]): void {
    const provenance: ProvenanceMetadata = {
      sourcePipeline: this._pipelineName,
      sourceTask: this.name,
      processedAt: new Date().toISOString(),
    };

    for (const item of items) {
      if (item && typeof item === 'object') {
        const obj = item as unknown as Record<string, unknown>;
        // Nested provenance metadata (for in-memory consumption)
        (obj as unknown as Provenanceable)._provenance = provenance;
        // Flat provenance fields (for graph persistence via entity types)
        obj['sourcePipeline'] = provenance.sourcePipeline;
        obj['sourceTask'] = provenance.sourceTask;
        obj['processedAt'] = provenance.processedAt;
      }
    }
  }
}
