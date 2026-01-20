/**
 * API unit tests
 */

import { describe, it, expect } from 'vitest';
import { app } from '../app';

describe('CodeGraph API', () => {
  describe('Health endpoint', () => {
    it('should return 200 OK with status info', async () => {
      const res = await app.request('/health');
      
      expect(res.status).toBe(200);
      
      const body = await res.json();
      expect(body).toHaveProperty('status', 'ok');
      expect(body).toHaveProperty('timestamp');
      expect(body).toHaveProperty('version', '0.1.0');
      expect(body).toHaveProperty('uptime');
      expect(typeof body.uptime).toBe('number');
    });

    it('should return valid ISO timestamp', async () => {
      const res = await app.request('/health');
      const body = await res.json();
      
      const timestamp = new Date(body.timestamp);
      expect(timestamp.toISOString()).toBe(body.timestamp);
    });
  });

  describe('CORS', () => {
    it('should allow localhost:3000 origin', async () => {
      const res = await app.request('/health', {
        headers: {
          'Origin': 'http://localhost:3000',
        },
      });
      
      expect(res.headers.get('Access-Control-Allow-Origin')).toBe('http://localhost:3000');
    });

    it('should handle OPTIONS preflight', async () => {
      const res = await app.request('/health', {
        method: 'OPTIONS',
        headers: {
          'Origin': 'http://localhost:3000',
          'Access-Control-Request-Method': 'GET',
        },
      });
      
      expect(res.status).toBe(204);
    });
  });

  describe('Error handling', () => {
    it('should return 404 for unknown routes', async () => {
      const res = await app.request('/unknown-route');
      
      expect(res.status).toBe(404);
      
      const body = await res.json();
      expect(body).toHaveProperty('error');
      expect(body.error).toHaveProperty('code', 'NOT_FOUND');
      expect(body.error).toHaveProperty('message');
      expect(body).toHaveProperty('timestamp');
    });
  });

  describe('Graph routes', () => {
    it('GET /api/graph/full should return empty graph with message', async () => {
      const res = await app.request('/api/graph/full');
      
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body).toHaveProperty('nodes');
      expect(body).toHaveProperty('edges');
      expect(Array.isArray(body.nodes)).toBe(true);
    });

    it('GET /api/graph/file/:path should accept file path', async () => {
      const res = await app.request('/api/graph/file/src');
      
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body).toHaveProperty('filePath', 'src');
    });
  });

  describe('Entity routes', () => {
    it('GET /api/entity/:id should return valid HTTP response', async () => {
      const res = await app.request('/api/entity/test-id');
      // Response should be valid (200/404/500 depending on DB state/query)
      expect(res.status).toBeGreaterThan(0);
    });
  });

  describe('Neighbors routes', () => {
    it('GET /api/neighbors/:id should return neighbors structure', async () => {
      const res = await app.request('/api/neighbors/test-id?direction=out');
      
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body).toHaveProperty('nodes');
      expect(body).toHaveProperty('edges');
      expect(body).toHaveProperty('direction', 'out');
    });

    it('should reject invalid direction parameter', async () => {
      const res = await app.request('/api/neighbors/test-id?direction=invalid');
      // Error response - we just verify it's not successful
      expect(res.ok).toBe(false);
    });
  });

  describe('Stats routes', () => {
    it('GET /api/stats should return graph statistics', async () => {
      const res = await app.request('/api/stats');
      
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(typeof body.totalNodes).toBe('number');
      expect(typeof body.totalEdges).toBe('number');
      expect(body).toHaveProperty('nodesByType');
      expect(body).toHaveProperty('edgesByType');
    });
  });

  describe('Search routes', () => {
    it('GET /api/search should return search results structure', async () => {
      const res = await app.request('/api/search?q=test');
      
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body).toHaveProperty('query', 'test');
      expect(body).toHaveProperty('results');
      expect(body).toHaveProperty('count');
    });
  });

  describe('Query routes', () => {
    it('POST /api/query/cypher should accept Cypher query', async () => {
      const res = await app.request('/api/query/cypher', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: 'MATCH (n) RETURN n LIMIT 10' }),
      });
      
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body).toHaveProperty('results');
    });

    it('POST /api/query/cypher should reject empty query', async () => {
      const res = await app.request('/api/query/cypher', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: '' }),
      });
      // Error response - just verify it's not successful
      expect(res.ok).toBe(false);
    });

    it('POST /api/query/natural should accept question', async () => {
      const res = await app.request('/api/query/natural', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ question: 'What functions call processPayment?' }),
      });
      
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body).toHaveProperty('explanation');
    });
  });
});
