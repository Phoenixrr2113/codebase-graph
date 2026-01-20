/**
 * Parse routes - /api/parse/*
 * Endpoints for parsing source code and updating the graph
 * @module routes/parse
 */

import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import { parseProject, parseSingleFile, removeFileFromGraph } from '../services/parseService';
import { HttpError } from '../middleware/errorHandler';
import { getOperations } from '../model';

const parse = new Hono();

/**
 * Request schema for parse project
 * @property path - Absolute path to project directory
 * @property ignore - Additional glob patterns to ignore
 * @property deepAnalysis - Enable CALLS/RENDERS extraction
 * @property includeExternals - Include external library references
 */
const parseProjectSchema = z.object({
  path: z.string().min(1, 'Project path is required'),
  ignore: z.array(z.string()).optional().default([]),
  deepAnalysis: z.boolean().optional().default(false),
  includeExternals: z.boolean().optional().default(false),
});

/**
 * Request schema for file operations
 * @property path - Absolute path to source file
 */
const filePathSchema = z.object({
  path: z.string().min(1, 'File path is required'),
});

/**
 * POST /api/parse/project
 * Parse an entire project directory and persist to graph
 * 
 * @body path - Project directory path
 * @body ignore - Additional ignore patterns
 * @body deepAnalysis - Enable deep analysis
 * @returns Parse result with entity/edge counts
 * @throws {HttpError} 400 on parse failure
 */
parse.post(
  '/project',
  zValidator('json', parseProjectSchema, (result) => {
    if (!result.success) {
      throw new HttpError(400, 'VALIDATION_ERROR', 'Invalid request body', result.error.issues);
    }
  }),
  async (c) => {
    const { path, ignore, deepAnalysis, includeExternals } = c.req.valid('json');
    const result = await parseProject(path, ignore, { deepAnalysis, includeExternals });
    
    if (result.status === 'error') {
      throw new HttpError(400, 'PARSE_ERROR', result.error ?? 'Unknown parse error');
    }
    
    return c.json(result);
  }
);

/**
 * POST /api/parse/file
 * Parse a single file for incremental updates
 * 
 * @body path - File path to parse
 * @returns Parse result with entity/edge counts
 * @throws {HttpError} 400 on parse failure
 */
parse.post(
  '/file',
  zValidator('json', filePathSchema, (result) => {
    if (!result.success) {
      throw new HttpError(400, 'VALIDATION_ERROR', 'Invalid request body', result.error.issues);
    }
  }),
  async (c) => {
    const { path } = c.req.valid('json');
    const result = await parseSingleFile(path);
    
    if (!result.success) {
      throw new HttpError(400, 'PARSE_ERROR', result.error ?? 'Unknown parse error');
    }
    
    return c.json({
      success: true,
      entities: result.entities,
      edges: result.edges,
    });
  }
);

/**
 * DELETE /api/parse/file
 * Remove a file and its entities from the graph
 * 
 * @body path - File path to remove
 * @returns Success confirmation
 * @throws {HttpError} 400 on failure
 */
parse.delete(
  '/file',
  zValidator('json', filePathSchema, (result) => {
    if (!result.success) {
      throw new HttpError(400, 'VALIDATION_ERROR', 'Invalid request body', result.error.issues);
    }
  }),
  async (c) => {
    const { path } = c.req.valid('json');
    const result = await removeFileFromGraph(path);
    
    if (!result.success) {
      throw new HttpError(400, 'DELETE_ERROR', result.error ?? 'Unknown error');
    }
    
    return c.json({ success: true });
  }
);

/**
 * DELETE /api/parse/clear
 * Clear all nodes and edges from the graph
 * 
 * @returns Success confirmation
 */
parse.delete(
  '/clear',
  async (c) => {
    const ops = await getOperations();
    await ops.clearAll();

    return c.json({ success: true, message: 'Graph cleared' });
  }
);

export { parse };

