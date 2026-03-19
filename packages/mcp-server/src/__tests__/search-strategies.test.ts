/**
 * MCP Search Strategy Integration Tests
 *
 * Tests search_code tool with strategy parameter.
 * Runs against real FalkorDB (Docker).
 */

import { describe, it, expect, afterAll } from 'vitest';
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { handleToolCall } from '../tools/router';
import { searchCode } from '../tools/searchCode';
import { teardownGraphClient } from './helpers';

const __dirname = dirname(fileURLToPath(import.meta.url));

// Load .env for API keys
try {
  const envPath = resolve(__dirname, '../../../../.env');
  const envContent = readFileSync(envPath, 'utf-8');
  for (const line of envContent.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eqIdx = trimmed.indexOf('=');
    if (eqIdx === -1) continue;
    const key = trimmed.slice(0, eqIdx).trim();
    const value = trimmed.slice(eqIdx + 1).trim();
    if (!process.env[key]) {
      process.env[key] = value;
    }
  }
} catch {
  // .env not found
}

afterAll(async () => {
  await teardownGraphClient();
});

describe('search_code — strategy parameter', () => {
  it('should work without strategy (backward compatibility)', async () => {
    const result = await searchCode({
      query: 'createClient',
      type: 'semantic',
    });

    expect(result.total).toBeGreaterThanOrEqual(0);
    expect(result.error).toBeUndefined();
  });

  it('should dispatch to HYBRID strategy', async () => {
    const result = await searchCode({
      query: 'createClient',
      strategy: 'HYBRID',
    });

    expect(result.error).toBeUndefined();
    expect(result.total).toBeGreaterThanOrEqual(0);
  });

  it('should be accessible via handleToolCall', async () => {
    const result = (await handleToolCall('search_code', {
      query: 'createClient',
      strategy: 'HYBRID',
    })) as Record<string, unknown>;

    expect(result.error).toBeUndefined();
    expect(result.total).toBeGreaterThanOrEqual(0);
  });
});
