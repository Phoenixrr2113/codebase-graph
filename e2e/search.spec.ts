/**
 * E2E Test: Search and Filter
 *
 * Tests search functionality and node filtering in the UI.
 */

import { test, expect } from '@playwright/test';
import path from 'node:path';

const API_URL = 'http://localhost:3001';
const SAMPLE_PROJECT_PATH = path.resolve(process.cwd(), 'e2e/fixtures/sample-project');

test.describe('Search Functionality', () => {
  test.beforeAll(async ({ request }) => {
    // Parse the sample project before tests
    await request.post(`${API_URL}/api/parse/project`, {
      data: { path: SAMPLE_PROJECT_PATH },
    });
  });

  test('should have a search input', async ({ page }) => {
    await page.goto('/');
    
    const searchInput = page.locator('input[type="search"], input[placeholder*="Search"], [data-testid="search-input"]');
    await expect(searchInput).toBeVisible({ timeout: 10000 });
  });

  test('should search via API', async ({ request }) => {
    const response = await request.get(`${API_URL}/api/search?q=user`);
    
    expect(response.ok()).toBeTruthy();
    
    const data = await response.json();
    expect(data.results).toBeDefined();
    expect(Array.isArray(data.results)).toBe(true);
  });

  test('should search for functions', async ({ request }) => {
    const response = await request.get(`${API_URL}/api/search?q=createUser&types=Function`);
    
    expect(response.ok()).toBeTruthy();
    
    const data = await response.json();
    expect(data.results).toBeDefined();
  });

  test('should search for classes', async ({ request }) => {
    const response = await request.get(`${API_URL}/api/search?q=OrderService&types=Class`);
    
    expect(response.ok()).toBeTruthy();
    
    const data = await response.json();
    expect(data.results).toBeDefined();
  });
});

test.describe('Node Selection', () => {
  test.beforeAll(async ({ request }) => {
    await request.post(`${API_URL}/api/parse/project`, {
      data: { path: SAMPLE_PROJECT_PATH },
    });
  });

  test('should display entity detail panel', async ({ page }) => {
    await page.goto('/');
    
    // Look for detail panel or sidebar
    const detailPanel = page.locator('[data-testid="entity-detail"], .entity-detail, aside');
    await expect(detailPanel).toBeVisible({ timeout: 10000 });
  });

  test('should have clickable nodes', async ({ page }) => {
    await page.goto('/');
    
    // Wait for graph to load
    await page.waitForTimeout(2000);
    
    // Check that the graph canvas exists and is interactive
    const graphCanvas = page.locator('[data-testid="graph-canvas"], #cy, canvas, .cytoscape-container');
    await expect(graphCanvas).toBeVisible({ timeout: 10000 });
    
    // Verify the canvas/container accepts pointer events
    const isInteractive = await graphCanvas.evaluate((el) => {
      const style = window.getComputedStyle(el);
      return style.pointerEvents !== 'none';
    });
    
    expect(isInteractive).toBe(true);
  });
});

test.describe('Graph Query', () => {
  test('should execute Cypher query via API', async ({ request }) => {
    const response = await request.post(`${API_URL}/api/query/cypher`, {
      data: {
        query: 'MATCH (n) RETURN count(n) as count LIMIT 1',
        params: {},
      },
    });

    expect(response.ok()).toBeTruthy();
    
    const data = await response.json();
    expect(data.results).toBeDefined();
  });

  test('should get full graph via API', async ({ request }) => {
    const response = await request.get(`${API_URL}/api/graph/full?limit=100`);
    
    expect(response.ok()).toBeTruthy();
    
    const data = await response.json();
    expect(data.nodes).toBeDefined();
    expect(data.edges).toBeDefined();
    expect(Array.isArray(data.nodes)).toBe(true);
    expect(Array.isArray(data.edges)).toBe(true);
  });
});
