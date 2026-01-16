/**
 * E2E Test: Parse API
 *
 * Tests the project parsing flow via the API endpoints.
 */

import { test, expect } from '@playwright/test';
import path from 'node:path';

const API_URL = 'http://localhost:3001';
const SAMPLE_PROJECT_PATH = path.resolve(process.cwd(), 'e2e/fixtures/sample-project');

test.describe('Parse API', () => {
  test('should parse a project successfully', async ({ request }) => {
    const response = await request.post(`${API_URL}/api/parse/project`, {
      data: {
        path: SAMPLE_PROJECT_PATH,
      },
    });

    expect(response.ok()).toBeTruthy();
    
    const data = await response.json();
    expect(data.status).toBe('complete');
    expect(data.stats).toBeDefined();
    expect(data.stats.files).toBeGreaterThan(0);
  });

  test('should parse a single file', async ({ request }) => {
    const filePath = path.join(SAMPLE_PROJECT_PATH, 'src/user.ts');
    
    const response = await request.post(`${API_URL}/api/parse/file`, {
      data: {
        path: filePath,
      },
    });

    expect(response.ok()).toBeTruthy();
    
    const data = await response.json();
    expect(data.success).toBe(true);
  });

  test('should return error for non-existent project path', async ({ request }) => {
    const response = await request.post(`${API_URL}/api/parse/project`, {
      data: {
        path: '/non/existent/path',
      },
    });

    const data = await response.json();
    expect(data.status).toBe('error');
    expect(data.error).toBeDefined();
  });

  test('should return graph statistics after parsing', async ({ request }) => {
    // First parse the project
    await request.post(`${API_URL}/api/parse/project`, {
      data: { path: SAMPLE_PROJECT_PATH },
    });

    // Then get stats
    const response = await request.get(`${API_URL}/api/stats`);
    expect(response.ok()).toBeTruthy();

    const stats = await response.json();
    expect(stats.totalNodes).toBeDefined();
    expect(stats.totalEdges).toBeDefined();
  });
});

test.describe('Health Check', () => {
  test('should return healthy status', async ({ request }) => {
    const response = await request.get(`${API_URL}/health`);
    expect(response.ok()).toBeTruthy();

    const data = await response.json();
    expect(data.status).toBe('ok');
  });
});
