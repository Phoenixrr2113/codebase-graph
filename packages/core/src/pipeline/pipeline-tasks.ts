/**
 * Pipeline Tasks (WS13.4)
 *
 * Wraps the existing extraction pipeline functions as Task instances
 * compatible with PipelineRunner. Provides a factory function to
 * create the full extraction pipeline.
 *
 * Pipeline stages:
 *   1. parse: file path → ParsedFile (AST + FileEntity)
 *   2. extract: ParsedFile → ParsedFileEntities (entities + edges)
 *
 * Usage:
 *   const pipeline = createExtractionPipeline({ deepAnalysis: true });
 *   const result = await pipeline.run(filePaths);
 */

import { createLogger } from '@codegraph/logger';
import type { FileEntity, ParsedFileEntities } from '@codegraph/types';
import type Parser from 'tree-sitter';
import { Task } from './task';
import { PipelineRunner } from './runner';
import {
  registerPlugins,
  createFileEntity,
  extractEntitiesForFile,
  buildParsedFileEntities,
} from './pipeline';
import { parseFile, type SyntaxTree, initParser } from './parser';
import type { PipelineOptions } from './pipeline';

const logger = createLogger({ namespace: 'core:pipeline:tasks' });

// ============================================================================
// Intermediate Types
// ============================================================================

/** Result of the parse stage: file entity + syntax tree */
export interface ParsedFile {
  /** The file entity with metadata */
  file: FileEntity;
  /** The parsed syntax tree (for entity extraction) */
  tree: SyntaxTree;
  /** Original file path */
  filePath: string;
}

// ============================================================================
// Parse Task
// ============================================================================

/**
 * Create a parse Task that reads files and produces ASTs.
 * Input: file path strings
 * Output: ParsedFile (FileEntity + SyntaxTree)
 */
export function createParseTask(): Task<string, ParsedFile> {
  return new Task<string, ParsedFile>({
    name: 'parse',
    description: 'Parse source files into ASTs',
    itemLevel: true,
    continueOnError: true,
    process: async (filePath: string): Promise<ParsedFile> => {
      // Ensure parser is initialized
      await initParser();
      registerPlugins();

      // Create file entity (reads file, computes hash, LOC, etc.)
      const file = await createFileEntity(filePath);

      // Parse into AST
      const tree = await parseFile(filePath);

      return { file, tree, filePath };
    },
  });
}

// ============================================================================
// Extract Task
// ============================================================================

/**
 * Create an extract Task that extracts entities and edges from parsed files.
 * Input: ParsedFile (from parse task)
 * Output: ParsedFileEntities (ready for graph persistence)
 */
export function createExtractTask(
  options: PipelineOptions = {},
  projectRoot?: string,
): Task<ParsedFile, ParsedFileEntities> {
  return new Task<ParsedFile, ParsedFileEntities>({
    name: 'extract',
    description: 'Extract entities and relationships from ASTs',
    itemLevel: true,
    continueOnError: true,
    process: async (parsed: ParsedFile): Promise<ParsedFileEntities> => {
      // Extract entities from AST
      const extracted = extractEntitiesForFile(
        parsed.tree.rootNode as unknown as Parser.SyntaxNode,
        parsed.filePath,
      );

      // Build the full ParsedFileEntities with edges
      const result = buildParsedFileEntities(
        parsed.file,
        extracted,
        parsed.tree.rootNode as unknown as Parser.SyntaxNode,
        options,
        projectRoot,
      );

      logger.info(
        `Extracted from ${parsed.filePath}: ` +
        `${result.functions.length} functions, ` +
        `${result.classes.length} classes, ` +
        `${result.interfaces.length} interfaces`,
      );

      return result;
    },
  });
}

// ============================================================================
// Extraction Pipeline Factory
// ============================================================================

/** Configuration for the extraction pipeline */
export interface ExtractionPipelineConfig {
  /** Pipeline name (default: 'extraction') */
  name?: string;
  /** Enable deep analysis (call edges, render edges) */
  deepAnalysis?: boolean;
  /** Include external/unresolved references */
  includeExternals?: boolean;
  /** Project root for import resolution */
  projectRoot?: string;
  /** Enable incremental processing (skip unchanged files) */
  incremental?: boolean;
  /** State directory for incremental processing */
  stateDir?: string;
}

/**
 * Create a complete extraction pipeline that:
 *   1. Parses source files into ASTs
 *   2. Extracts entities and relationships
 *
 * Returns a PipelineRunner that can be executed with file paths.
 */
export function createExtractionPipeline(
  config: ExtractionPipelineConfig = {},
): PipelineRunner {
  const {
    name = 'extraction',
    deepAnalysis = false,
    includeExternals = false,
    projectRoot,
    incremental = false,
    stateDir,
  } = config;

  const parseTask = createParseTask();
  const extractTask = createExtractTask(
    { deepAnalysis, includeExternals },
    projectRoot,
  );

  const runnerConfig: ConstructorParameters<typeof PipelineRunner>[0] = {
    name,
    tasks: [parseTask as Task, extractTask as Task],
    incremental,
  };
  if (stateDir) {
    runnerConfig.stateDir = stateDir;
  }

  return new PipelineRunner(runnerConfig);
}
