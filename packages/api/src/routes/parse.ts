/**
 * Parse routes - /api/parse/*
 * Endpoints for parsing source code and updating the graph
 */

import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import { parseProject, parseSingleFile, removeFileFromGraph } from '../services/parseService.js';
import { HttpError } from '../middleware/errorHandler.js';

const parse = new Hono();

/** Schema for parse project request */
const parseProjectSchema = z.object({
  path: z.string().min(1, 'Project path is required'),
  ignore: z.array(z.string()).optional().default([]),
});

/** Schema for parse/delete file request */
const filePathSchema = z.object({
  path: z.string().min(1, 'File path is required'),
});

/**
 * POST /api/parse/project
 * Parse an entire project directory
 */
parse.post(
  '/project',
  zValidator('json', parseProjectSchema, (result) => {
    if (!result.success) {
      throw new HttpError(400, 'VALIDATION_ERROR', 'Invalid request body', result.error.issues);
    }
  }),
  async (c) => {
    const { path, ignore } = c.req.valid('json');
    const result = await parseProject(path, ignore);
    
    if (result.status === 'error') {
      throw new HttpError(400, 'PARSE_ERROR', result.error ?? 'Unknown parse error');
    }
    
    return c.json(result);
  }
);

/**
 * POST /api/parse/file
 * Parse a single file (incremental update)
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
 * Remove a file from the graph
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
 * Clear all data from the graph
 */
parse.delete(
  '/clear',
  async (c) => {
    const { createClient, createOperations } = await import('@codegraph/graph');
    const client = await createClient();
    const ops = createOperations(client);
    await ops.clearAll();

    return c.json({ success: true, message: 'Graph cleared' });
  }
);

export { parse };
