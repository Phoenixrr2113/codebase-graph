/**
 * Pipeline Orchestration — Types
 *
 * Defines the event types, task configuration, and provenance
 * metadata used by the Task wrapper and Pipeline runner.
 */

// ============================================================================
// Task Configuration
// ============================================================================

export interface TaskConfig<TIn = unknown, TOut = unknown> {
  /** Unique identifier for this task (e.g., 'parse', 'extract', 'embed') */
  name: string;
  /** Human-readable description */
  description?: string;
  /** How many items to buffer before yielding a batch */
  batchSize?: number;
  /**
   * The processing function. Can be:
   *   - A batch function: (items: TIn[]) => Promise<TOut[]>
   *   - An item function: (item: TIn) => Promise<TOut>
   */
  process: ((items: TIn[]) => Promise<TOut[]>) | ((item: TIn) => Promise<TOut>);
  /** Whether `process` operates on individual items (true) or batches (false, default) */
  itemLevel?: boolean;
  /** Whether errors on individual items should skip that item (true) or abort (false, default) */
  continueOnError?: boolean;
}

// ============================================================================
// Provenance Metadata
// ============================================================================

export interface ProvenanceMetadata {
  /** Pipeline that produced this data (e.g., 'extract', 'embed', 'ingest') */
  sourcePipeline: string;
  /** Task that produced this data (e.g., 'parse', 'extractEntities') */
  sourceTask: string;
  /** When this data was processed */
  processedAt: string;
}

export interface Provenanceable {
  /** Provenance metadata (auto-stamped by Task wrapper) */
  _provenance?: ProvenanceMetadata;
}

// ============================================================================
// Pipeline Events
// ============================================================================

export type PipelineEventType = 'task:start' | 'task:progress' | 'task:complete' | 'task:error' | 'pipeline:start' | 'pipeline:complete' | 'item:error';

export interface PipelineEvent {
  type: PipelineEventType;
  /** Task name (if applicable) */
  task?: string;
  /** Timestamp */
  timestamp: string;
  /** Current progress (items processed so far) */
  processed?: number;
  /** Total items expected */
  total?: number;
  /** Duration of the task in ms */
  durationMs?: number;
  /** Error details (for error events) */
  error?: string;
  /** The item that caused the error */
  errorItem?: unknown;
  /** How many items were produced */
  outputCount?: number;
}

// ============================================================================
// Pipeline Configuration
// ============================================================================

export interface PipelineRunConfig {
  /** Pipeline name for provenance stamping */
  name: string;
  /** Whether to track file hashes for incremental processing */
  incremental?: boolean;
  /** Directory to store incremental processing state */
  stateDir?: string;
}

// ============================================================================
// Incremental Processing State
// ============================================================================

export interface FileProcessingState {
  /** File content hash (used to detect changes) */
  hash: string;
  /** Last time this file was processed */
  processedAt: string;
  /** Pipeline that last processed this file */
  pipeline: string;
}

export type IncrementalState = Record<string, FileProcessingState>;
