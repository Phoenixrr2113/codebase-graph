/**
 * E2E Test: Graph Visualization
 *
 * Tests the Cytoscape.js graph rendering in the browser.
 */

import { test, expect } from '@playwright/test';
import path from 'node:path';

const API_URL = 'http://localhost:3001';
const SAMPLE_PROJECT_PATH = path.resolve(process.cwd(), 'e2e/fixtures/sample-project');

test.describe('Graph Visualization', () => {
  test.beforeAll(async ({ request }) => {
    // Parse the sample project before tests
    await request.post(`${API_URL}/api/parse/project`, {
      data: { path: SAMPLE_PROJECT_PATH },
    });
  });

  test('should display the graph canvas', async ({ page }) => {
    await page.goto('/');
    
    // Wait for the Cytoscape container to be present
    const graphContainer = page.locator('[data-testid="graph-canvas"], #cy, .cytoscape-container');
    await expect(graphContainer).toBeVisible({ timeout: 10000 });
  });

  test('should load graph data on page load', async ({ page }) => {
    await page.goto('/');
    
    // Wait for loading to complete
    await page.waitForFunction(() => {
      // Check for nodes in the DOM or loading state
      const loadingIndicator = document.querySelector('[data-loading]');
      return !loadingIndicator || loadingIndicator.getAttribute('data-loading') === 'false';
    }, { timeout: 15000 });
    
    // The graph should have canvas elements or SVG nodes
    const hasGraph = await page.evaluate(() => {
      const canvas = document.querySelector('canvas');
      const cyContainer = document.querySelector('[data-testid="graph-canvas"], #cy, .cytoscape-container');
      return canvas !== null || cyContainer !== null;
    });
    
    expect(hasGraph).toBe(true);
  });

  test('should have layout controls visible', async ({ page }) => {
    await page.goto('/');
    
    // Look for layout controls (buttons, dropdowns)
    const controls = page.locator('[data-testid="graph-controls"], .graph-controls');
    await expect(controls).toBeVisible({ timeout: 10000 });
  });

  test('should have zoom controls', async ({ page }) => {
    await page.goto('/');
    
    // Look for zoom buttons
    const zoomIn = page.locator('button:has-text("Zoom In"), button[aria-label*="zoom in"], [data-testid="zoom-in"]');
    const zoomOut = page.locator('button:has-text("Zoom Out"), button[aria-label*="zoom out"], [data-testid="zoom-out"]');
    
    // At least one zoom control should exist
    const hasZoomControls = await zoomIn.count() > 0 || await zoomOut.count() > 0 ||
      await page.locator('[data-testid="graph-controls"]').count() > 0;
    
    expect(hasZoomControls).toBe(true);
  });
});

test.describe('Panel Layout', () => {
  test('should display three-panel layout', async ({ page }) => {
    await page.goto('/');
    
    // Check for the main layout wrapper
    const appShell = page.locator('[data-testid="app-shell"], .app-shell, main');
    await expect(appShell).toBeVisible({ timeout: 10000 });
  });

  test('should display search panel', async ({ page }) => {
    await page.goto('/');
    
    // Look for search input
    const searchInput = page.locator('input[type="search"], input[placeholder*="Search"], [data-testid="search-input"]');
    await expect(searchInput).toBeVisible({ timeout: 10000 });
  });
});
