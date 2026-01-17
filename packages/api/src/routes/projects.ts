/**
 * Project routes - /api/projects/*
 * Endpoints for managing parsed projects
 */

import { Hono } from 'hono';
import { createClient, createOperations } from '@codegraph/graph';

const projects = new Hono();

/**
 * GET /api/projects
 * List all parsed projects
 */
projects.get('/', async (c) => {
  try {
    const client = await createClient();
    const ops = createOperations(client);
    const projectList = await ops.getProjects();
    return c.json({ projects: projectList });
  } catch {
    // Handle empty graph case - return empty array instead of error
    // This is normal when no projects have been parsed yet
    return c.json({ projects: [] });
  }
});

/**
 * DELETE /api/projects/:id
 * Delete a project and all its data
 */
projects.delete('/:id', async (c) => {
  const projectId = c.req.param('id');
  const client = await createClient();
  const ops = createOperations(client);
  await ops.deleteProject(projectId);
  return c.json({ success: true, message: 'Project deleted' });
});

export { projects };
