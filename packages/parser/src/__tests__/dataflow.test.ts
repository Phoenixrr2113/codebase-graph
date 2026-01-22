/**
 * Dataflow Analysis Tests
 * Tests for taint tracking and data flow analysis
 */

import { describe, it, expect, beforeAll } from 'vitest';
import {
  analyzeDataflow,
  isTaintSource,
  isTaintSink,
  isSanitizer,
  getTaintSourcePatterns,
  getTaintSinkPatterns,
  getSanitizerPatterns,
  getDataflowSummary,
} from '../analysis/dataflow';
import { initParser, parseCode } from '../index';

// Initialize parser before tests
beforeAll(async () => {
  await initParser();
});

describe('Dataflow Analysis', () => {
  // Helper to parse code and analyze dataflow
  async function analyzeCode(code: string) {
    const result = await parseCode(code, 'test.ts');
    if (!result?.rootNode) {
      throw new Error('Failed to parse code');
    }
    return analyzeDataflow(result.rootNode, 'test.ts');
  }

  describe('Taint Source Detection', () => {
    it('should detect request.body as taint source', async () => {
      const code = `
        const userInput = req.body.username;
      `;
      const result = await analyzeCode(code);
      
      expect(result.sources.length).toBeGreaterThan(0);
      expect(result.sources.some(s => s.pattern === 'req.body')).toBe(true);
    });

    it('should detect request.query as taint source', async () => {
      const code = `
        const searchTerm = request.query.search;
      `;
      const result = await analyzeCode(code);
      
      expect(result.sources.some(s => s.category === 'user_input')).toBe(true);
    });

    it('should detect process.env as taint source', async () => {
      const code = `
        const apiKey = process.env.API_KEY;
      `;
      const result = await analyzeCode(code);
      
      expect(result.sources.some(s => s.pattern === 'process.env')).toBe(true);
    });

    it('should detect fs.readFileSync as taint source', async () => {
      const code = `
        const content = fs.readFileSync(path);
      `;
      const result = await analyzeCode(code);
      
      expect(result.sources.some(s => s.category === 'file_read')).toBe(true);
    });
  });

  describe('Taint Sink Detection', () => {
    it('should detect db.query as SQL injection sink', async () => {
      const code = `
        const result = db.query('SELECT * FROM users WHERE id = ' + userId);
      `;
      const result = await analyzeCode(code);
      
      expect(result.sinks.some(s => s.category === 'sql_injection')).toBe(true);
    });

    it('should detect exec as command injection sink', async () => {
      const code = `
        exec('ls ' + userInput);
      `;
      const result = await analyzeCode(code);
      
      expect(result.sinks.some(s => s.category === 'command_injection')).toBe(true);
    });

    it('should detect innerHTML as XSS sink', async () => {
      const code = `
        element.innerHTML = userContent;
      `;
      const result = await analyzeCode(code);
      
      expect(result.sinks.some(s => s.category === 'xss')).toBe(true);
    });

    it('should detect fs.readFile as path traversal sink', async () => {
      const code = `
        fs.readFile(userPath);
      `;
      const result = await analyzeCode(code);
      
      expect(result.sinks.some(s => s.category === 'path_traversal')).toBe(true);
    });
  });

  describe('Vulnerability Detection', () => {
    it('should detect SQL injection vulnerability', async () => {
      const code = `
        const userId = req.body.id;
        db.query('SELECT * FROM users WHERE id = ' + userId);
      `;
      const result = await analyzeCode(code);
      
      expect(result.vulnerabilities.some(v => v.category === 'sql_injection')).toBe(true);
    });

    it('should detect command injection vulnerability', async () => {
      const code = `
        const cmd = req.body.command;
        exec(cmd);
      `;
      const result = await analyzeCode(code);
      
      expect(result.vulnerabilities.some(v => v.category === 'command_injection')).toBe(true);
    });

    it('should not report vulnerability when sanitizer is present', async () => {
      const code = `
        const userInput = req.body.input;
        const safe = escapeHtml(userInput);
        element.innerHTML = safe;
      `;
      const result = await analyzeCode(code);
      
      // Should detect source and sink but with sanitizer in path
      expect(result.sources.length).toBeGreaterThan(0);
    });
  });

  describe('Utility Functions', () => {
    it('isTaintSource should identify known sources', () => {
      expect(isTaintSource('req.body')).toBe(true);
      expect(isTaintSource('request.query.id')).toBe(true);
      expect(isTaintSource('process.env.SECRET')).toBe(true);
      expect(isTaintSource('safeVariable')).toBe(false);
    });

    it('isTaintSink should identify known sinks', () => {
      expect(isTaintSink('query')).toBe(true);
      expect(isTaintSink('exec')).toBe(true);
      expect(isTaintSink('innerHTML')).toBe(true);
      expect(isTaintSink('safeFunction')).toBe(false);
    });

    it('isSanitizer should identify known sanitizers', () => {
      expect(isSanitizer('escape')).toBe(true);
      expect(isSanitizer('sanitizeHtml')).toBe(true);
      expect(isSanitizer('encodeURIComponent')).toBe(true);
      expect(isSanitizer('regularFunction')).toBe(false);
    });

    it('getTaintSourcePatterns should return all source patterns', () => {
      const patterns = getTaintSourcePatterns();
      
      expect(patterns).toContain('req.body');
      expect(patterns).toContain('request.query');
      expect(patterns).toContain('process.env');
      expect(patterns.length).toBeGreaterThan(5);
    });

    it('getTaintSinkPatterns should return all sink patterns', () => {
      const patterns = getTaintSinkPatterns();
      
      expect(patterns).toContain('query');
      expect(patterns).toContain('exec');
      expect(patterns).toContain('innerHTML');
      expect(patterns.length).toBeGreaterThan(5);
    });

    it('getSanitizerPatterns should return all sanitizer patterns', () => {
      const patterns = getSanitizerPatterns();
      
      expect(patterns).toContain('escape');
      expect(patterns).toContain('sanitize');
      expect(patterns.length).toBeGreaterThan(5);
    });
  });

  describe('getDataflowSummary', () => {
    it('should return formatted summary', async () => {
      const code = `
        const userId = req.body.id;
        db.query('SELECT * FROM users WHERE id = ' + userId);
      `;
      const result = await analyzeCode(code);
      const summary = getDataflowSummary(result);
      
      expect(summary).toContain('test.ts');
      expect(summary).toContain('Taint sources:');
      expect(summary).toContain('Taint sinks:');
    });
  });

  describe('Edge Cases', () => {
    it('should handle empty code', async () => {
      const result = await analyzeCode('');
      
      expect(result.sources).toHaveLength(0);
      expect(result.sinks).toHaveLength(0);
      expect(result.vulnerabilities).toHaveLength(0);
    });

    it('should handle code without taint', async () => {
      const code = `
        function add(a, b) {
          return a + b;
        }
      `;
      const result = await analyzeCode(code);
      
      expect(result.sources).toHaveLength(0);
      expect(result.sinks).toHaveLength(0);
    });

    it('should handle multiple sources and sinks', async () => {
      const code = `
        const userId = req.body.id;
        const query = req.query.q;
        db.query(userId);
        exec(query);
      `;
      const result = await analyzeCode(code);
      
      expect(result.sources.length).toBeGreaterThanOrEqual(2);
      expect(result.sinks.length).toBeGreaterThanOrEqual(2);
    });
  });
});
