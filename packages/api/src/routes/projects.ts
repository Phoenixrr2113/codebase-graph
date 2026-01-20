/**
 * Project routes - /api/projects/*
 * Endpoints for managing parsed projects
 * @module routes/projects
 */

import { Hono } from 'hono';
import { createLogger } from '@codegraph/logger';
import { HttpError } from '../middleware/errorHandler';
import { getOperations } from '../model';

const logger = createLogger({ namespace: 'API:Projects' });
const projects = new Hono();

/**
 * GET /api/projects
 * List all parsed projects
 * @returns Array of project entities
 */
projects.get('/', async (c) => {
  try {
    const ops = await getOperations();
    const projectList = await ops.getProjects();
    return c.json({ projects: projectList });
  } catch {
    return c.json({ projects: [] });
  }
});

/**
 * DELETE /api/projects/:id
 * Delete a project and all its data
 * @param id - Project UUID
 * @returns Success confirmation
 * @throws {HttpError} 400 if project ID missing, 500 on failure
 */
projects.delete('/:id', async (c) => {
  const projectId = c.req.param('id');

  if (!projectId) {
    throw new HttpError(400, 'VALIDATION_ERROR', 'Project ID is required');
  }

  try {
    const ops = await getOperations();
    await ops.deleteProject(projectId);
    logger.info(`Project deleted: ${projectId}`);
    return c.json({ success: true, message: 'Project deleted' });
  } catch (error) {
    logger.error('Failed to delete project', error);
    throw new HttpError(500, 'DELETE_ERROR', 'Failed to delete project');
  }
});

export { projects };
