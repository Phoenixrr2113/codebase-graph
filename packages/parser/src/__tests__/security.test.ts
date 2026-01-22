/**
 * Security Scanner Tests
 * Tests for detecting various security vulnerabilities
 */

import { describe, it, expect, beforeAll } from 'vitest';
import {
  scanForVulnerabilities,
  scanFile,
  sortBySeverity,
  severityToNumber,
  SecurityFinding,
} from '../analysis/security';
import { initParser, parseCode } from '../index';

// Initialize parser before tests
beforeAll(async () => {
  await initParser();
});

describe('Security Scanner', () => {
  // Helper to parse code and scan for vulnerabilities
  async function scanCode(code: string): Promise<SecurityFinding[]> {
    const result = await parseCode(code, 'test.ts');
    if (!result?.rootNode) {
      throw new Error('Failed to parse code');
    }
    return scanForVulnerabilities(result.rootNode, { filePath: 'test.ts' });
  }

  describe('SQL Injection Detection', () => {
    it('should detect SQL injection via template literal', async () => {
      const code = `
        const userId = req.params.id;
        db.query(\`SELECT * FROM users WHERE id = \${userId}\`);
      `;
      const findings = await scanCode(code);

      expect(findings).toHaveLength(1);
      expect(findings[0].type).toBe('sql_injection');
      expect(findings[0].severity).toBe('critical');
    });

    it('should detect SQL injection via string concatenation', async () => {
      const code = `
        const userId = req.params.id;
        db.query("SELECT * FROM users WHERE id = " + userId);
      `;
      const findings = await scanCode(code);

      expect(findings).toHaveLength(1);
      expect(findings[0].type).toBe('sql_injection');
    });

    it('should detect Prisma raw query injection', async () => {
      const code = `
        const name = req.body.name;
        prisma.$queryRaw(\`SELECT * FROM users WHERE name = \${name}\`);
      `;
      const findings = await scanCode(code);

      expect(findings.some(f => f.type === 'sql_injection')).toBe(true);
    });

    it('should not flag parameterized queries', async () => {
      const code = `
        const userId = req.params.id;
        db.query('SELECT * FROM users WHERE id = ?', [userId]);
      `;
      const findings = await scanCode(code);

      const sqlFindings = findings.filter(f => f.type === 'sql_injection');
      expect(sqlFindings).toHaveLength(0);
    });
  });

  describe('XSS Detection', () => {
    it('should detect innerHTML assignment', async () => {
      const code = `
        const userInput = req.body.content;
        element.innerHTML = userInput;
      `;
      const findings = await scanCode(code);

      expect(findings.some(f => f.type === 'xss')).toBe(true);
    });

    it('should detect dangerouslySetInnerHTML in JSX', async () => {
      const code = `
        function Component({ html }) {
          return <div dangerouslySetInnerHTML={{ __html: html }} />;
        }
      `;
      // Parse as TSX for proper JSX node recognition
      const result = await parseCode(code, 'test.tsx');
      if (!result?.rootNode) throw new Error('Failed to parse');
      const findings = scanForVulnerabilities(result.rootNode, { filePath: 'test.tsx' });

      expect(findings.some(f => f.type === 'xss')).toBe(true);
    });

    it('should detect document.write', async () => {
      const code = `
        const content = getContent();
        document.write(content);
      `;
      const findings = await scanCode(code);

      expect(findings.some(f => f.type === 'xss')).toBe(true);
    });
  });

  describe('Command Injection Detection', () => {
    it('should detect exec with template literal', async () => {
      const code = `
        const userInput = req.body.command;
        exec(\`ls -la \${userInput}\`);
      `;
      const findings = await scanCode(code);

      expect(findings.some(f => f.type === 'command_injection')).toBe(true);
      expect(findings.find(f => f.type === 'command_injection')?.severity).toBe('critical');
    });

    it('should detect spawn with concatenation', async () => {
      const code = `
        const file = req.params.file;
        spawn('cat ' + file);
      `;
      const findings = await scanCode(code);

      expect(findings.some(f => f.type === 'command_injection')).toBe(true);
    });
  });

  describe('Path Traversal Detection', () => {
    it('should detect fs.readFile with user input', async () => {
      const code = `
        const filename = req.params.filename;
        fs.readFile(filename);
      `;
      const findings = await scanCode(code);

      expect(findings.some(f => f.type === 'path_traversal')).toBe(true);
    });

    it('should detect fs.readFileSync with dynamic path', async () => {
      const code = `
        const path = req.body.path;
        const content = fs.readFileSync(path);
      `;
      const findings = await scanCode(code);

      expect(findings.some(f => f.type === 'path_traversal')).toBe(true);
    });
  });

  describe('Hardcoded Secrets Detection', () => {
    it('should detect hardcoded API key', async () => {
      const code = `
        const config = {
          apiKey: 'sk_live_1234567890abcdef1234567890abcdef'
        };
      `;
      const findings = await scanCode(code);

      expect(findings.some(f => f.type === 'hardcoded_secret')).toBe(true);
      expect(findings.find(f => f.type === 'hardcoded_secret')?.severity).toBe('critical');
    });

    it('should detect hardcoded Stripe keys', async () => {
      const code = `
        const stripe = require('stripe')('sk_test_1234567890abcdef1234567890');
      `;
      const findings = await scanCode(code);

      expect(findings.some(f => f.type === 'hardcoded_secret')).toBe(true);
    });

    it('should detect hardcoded AWS access keys', async () => {
      const code = `
        const aws = {
          accessKeyId: 'AKIAIOSFODNN7EXAMPLE'
        };
      `;
      const findings = await scanCode(code);

      expect(findings.some(f => f.type === 'hardcoded_secret')).toBe(true);
    });

    it('should detect hardcoded passwords', async () => {
      const code = `
        const dbConfig = {
          password: 'supersecretpassword123'
        };
      `;
      const findings = await scanCode(code);

      expect(findings.some(f => f.type === 'hardcoded_secret')).toBe(true);
    });

    it('should not flag environment variable access', async () => {
      const code = `
        const apiKey = process.env.API_KEY;
      `;
      const findings = await scanCode(code);

      const secretFindings = findings.filter(f => f.type === 'hardcoded_secret');
      expect(secretFindings).toHaveLength(0);
    });
  });

  describe('Eval Detection', () => {
    it('should detect eval usage', async () => {
      const code = `
        const code = getUserCode();
        eval(code);
      `;
      const findings = await scanCode(code);

      expect(findings.some(f => f.type === 'eval')).toBe(true);
    });

    it('should detect new Function()', async () => {
      const code = `
        const fn = new Function('a', 'b', 'return a + b');
      `;
      const findings = await scanCode(code);

      expect(findings.some(f => f.type === 'eval')).toBe(true);
    });

    it('should detect setTimeout with string', async () => {
      const code = `
        setTimeout('alert("xss")', 1000);
      `;
      const findings = await scanCode(code);

      expect(findings.some(f => f.type === 'eval')).toBe(true);
    });

    it('should not flag setTimeout with function', async () => {
      const code = `
        setTimeout(() => console.log('hello'), 1000);
      `;
      const findings = await scanCode(code);

      const evalFindings = findings.filter(f => f.type === 'eval');
      expect(evalFindings).toHaveLength(0);
    });
  });

  describe('scanFile aggregation', () => {
    it('should return findings with summary', async () => {
      const code = `
        const userId = req.params.id;
        db.query(\`SELECT * FROM users WHERE id = \${userId}\`);
        element.innerHTML = content;
        eval(code);
      `;
      const result = await parseCode(code, 'test.ts');
      if (!result?.rootNode) throw new Error('Failed to parse');

      const { findings, summary } = scanFile(result.rootNode, 'test.ts');

      expect(findings.length).toBeGreaterThan(0);
      expect(summary.total).toBe(findings.length);
      expect(summary.critical + summary.high + summary.medium + summary.low).toBe(summary.total);
    });
  });

  describe('Utility functions', () => {
    it('should convert severity to number correctly', () => {
      expect(severityToNumber('critical')).toBe(4);
      expect(severityToNumber('high')).toBe(3);
      expect(severityToNumber('medium')).toBe(2);
      expect(severityToNumber('low')).toBe(1);
      expect(severityToNumber('info')).toBe(0);
    });

    it('should sort findings by severity', async () => {
      const code = `
        db.query(\`SELECT * FROM \${table}\`);
        element.innerHTML = content;
      `;
      const findings = await scanCode(code);
      const sorted = sortBySeverity(findings);

      // Critical should come before high
      for (let i = 0; i < sorted.length - 1; i++) {
        expect(severityToNumber(sorted[i].severity))
          .toBeGreaterThanOrEqual(severityToNumber(sorted[i + 1].severity));
      }
    });
  });

  describe('Edge cases', () => {
    it('should handle empty code', async () => {
      const findings = await scanCode('');
      expect(findings).toHaveLength(0);
    });

    it('should handle code with no vulnerabilities', async () => {
      const code = `
        function add(a: number, b: number): number {
          return a + b;
        }
      `;
      const findings = await scanCode(code);
      expect(findings).toHaveLength(0);
    });

    it('should report correct line numbers', async () => {
      const code = `
        // line 1
        // line 2
        eval(code);
      `;
      const findings = await scanCode(code);

      expect(findings).toHaveLength(1);
      expect(findings[0].line).toBe(4); // eval is on line 4
    });
  });
});
