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

  test('should reject invalid history window inputs', async ({ request }) => {
    const response = await request.post(`${API_URL}/api/parse/project`, {
      data: {
        path: SAMPLE_PROJECT_PATH,
        historySince: '2026-02-30',
        historyMaxCommits: 0,
      },
    });

    expect(response.status()).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: 'historySince must be a valid ISO 8601 date or timestamp',
    });
  });

  for (const historySince of [
    '2026-02-30T00:00:00Z',
    '2026-04-31T12:00:00Z',
    '2025-02-29T00:00:00Z',
  ]) {
    test(`should reject impossible history timestamp ${historySince}`, async ({ request }) => {
      const response = await request.post(`${API_URL}/api/parse/project`, {
        data: { path: SAMPLE_PROJECT_PATH, historySince },
      });

      expect(response.status()).toBe(400);
      await expect(response.json()).resolves.toEqual({
        error: 'historySince must be a valid ISO 8601 date or timestamp',
      });
    });
  }

  test('should accept an explicit history window', async ({ request }) => {
    const response = await request.post(`${API_URL}/api/parse/project`, {
      data: {
        path: SAMPLE_PROJECT_PATH,
        historySince: '2025-01-01T00:00:00Z',
        historyMaxCommits: 2500,
      },
    });

    expect(response.ok()).toBeTruthy();
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
