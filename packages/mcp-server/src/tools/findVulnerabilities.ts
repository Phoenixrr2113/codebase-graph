/**
 * MCP Tool: find_vulnerabilities
 *
 * Scan for security vulnerabilities using tree-sitter pattern matching.
 * Uses @codegraph/core security scanner.
 */

import { readFile, stat as fsStat } from 'node:fs/promises';
import { glob } from 'glob';
import {
  initParser,
  parseCode,
  scanForVulnerabilities,
  sortBySeverity,
  type SecurityFinding,
} from '@codegraph/core';
import type { ToolDefinition } from './consolidated';

// Input schema
export interface FindVulnerabilitiesInput {
  scope?: string;
  severity?: 'critical' | 'high' | 'medium' | 'low' | 'all';
  category?: 'injection' | 'xss' | 'auth' | 'payment' | 'all';
}

// Vulnerability type
export interface Vulnerability {
  type: string;
  severity: 'critical' | 'high' | 'medium' | 'low';
  file: string;
  line: number;
  code: string;
  description: string;
  fix: string;
}

// Output type
export interface FindVulnerabilitiesOutput {
  vulnerabilities: Vulnerability[];
  summary: {
    critical: number;
    high: number;
    medium: number;
    low: number;
  };
  filesScanned: number;
  error?: string | undefined;
}

// Tool definition for MCP
export const findVulnerabilitiesToolDefinition: ToolDefinition = {
  name: 'find_vulnerabilities',
  description: 'Scan for security vulnerabilities using dataflow analysis.',
  inputSchema: {
    type: 'object',
    properties: {
      scope: {
        type: 'string',
        default: 'all',
        description: 'Scope to scan (file path or directory)',
      },
      severity: {
        type: 'string',
        enum: ['critical', 'high', 'medium', 'low', 'all'],
        default: 'all',
        description: 'Minimum severity to report',
      },
      category: {
        type: 'string',
        enum: ['injection', 'xss', 'auth', 'payment', 'all'],
        default: 'all',
        description: 'Vulnerability category to focus on',
      },
    },
    required: [],
  },
};

// Severity ranking for filtering
const SEVERITY_RANK: Record<string, number> = {
  critical: 4,
  high: 3,
  medium: 2,
  low: 1,
  info: 0,
};

/**
 * Handler for find_vulnerabilities tool
 */
export async function findVulnerabilities(input: FindVulnerabilitiesInput): Promise<FindVulnerabilitiesOutput> {
  try {
    const scope = (!input.scope || input.scope === 'all') ? process.cwd() : input.scope;

    // Find files to scan
    let files: string[];
    try {
      const fileStat = await fsStat(scope);
      if (fileStat.isFile()) {
        files = [scope];
      } else {
        // Glob for TypeScript/JavaScript files
        files = await glob('**/*.{ts,tsx,js,jsx}', {
          cwd: scope,
          absolute: true,
          ignore: ['**/node_modules/**', '**/dist/**', '**/build/**'],
        });
      }
    } catch {
      return {
        vulnerabilities: [],
        summary: { critical: 0, high: 0, medium: 0, low: 0 },
        filesScanned: 0,
        error: `Invalid scope: ${scope}`,
      };
    }

    // Initialize parser
    await initParser();

    const severity = input.severity ?? 'all';
    const category = input.category ?? 'all';
    const allFindings: SecurityFinding[] = [];
    let filesScanned = 0;

    // Scan each file
    for (const filePath of files.slice(0, 100)) { // Limit to 100 files
      try {
        const code = await readFile(filePath, 'utf-8');
        const ext = filePath.split('.').pop() ?? 'ts';
        const langMap: Record<string, 'typescript' | 'javascript' | 'tsx' | 'jsx'> = {
          ts: 'typescript',
          tsx: 'tsx',
          js: 'javascript',
          jsx: 'jsx',
        };
        const language = langMap[ext] ?? 'typescript';
        const tree = parseCode(code, language);

        const findings = scanForVulnerabilities(tree.rootNode, {
          filePath,
          includeLowSeverity: severity === 'all' || severity === 'low',
        });

        allFindings.push(...findings);
        filesScanned++;
      } catch {
        // Skip files that fail to parse
      }
    }

    // Sort by severity
    const sorted = sortBySeverity(allFindings);

    // Filter by minimum severity
    const minSeverity = SEVERITY_RANK[severity] ?? 0;
    const filtered = severity === 'all'
      ? sorted
      : sorted.filter(f => (SEVERITY_RANK[f.severity] ?? 0) >= minSeverity);

    // Filter by category
    const categoryFiltered = category === 'all'
      ? filtered
      : filtered.filter(f => {
        const typeLC = f.type.toLowerCase();
        if (category === 'injection') return typeLC.includes('injection');
        if (category === 'xss') return typeLC.includes('xss');
        if (category === 'auth') return typeLC.includes('auth') || typeLC.includes('password');
        if (category === 'payment') return typeLC.includes('payment') || typeLC.includes('stripe');
        return true;
      });

    // Map to output format
    const vulnerabilities: Vulnerability[] = categoryFiltered.map(f => ({
      type: f.type,
      severity: f.severity as 'critical' | 'high' | 'medium' | 'low',
      file: f.file,
      line: f.line,
      code: f.code,
      description: f.description,
      fix: f.fix,
    }));

    // Calculate summary
    const summary = {
      critical: vulnerabilities.filter(v => v.severity === 'critical').length,
      high: vulnerabilities.filter(v => v.severity === 'high').length,
      medium: vulnerabilities.filter(v => v.severity === 'medium').length,
      low: vulnerabilities.filter(v => v.severity === 'low').length,
    };

    return {
      vulnerabilities,
      summary,
      filesScanned,
    };
  } catch (error) {
    return {
      vulnerabilities: [],
      summary: { critical: 0, high: 0, medium: 0, low: 0 },
      filesScanned: 0,
      error: error instanceof Error ? error.message : 'Unknown error scanning for vulnerabilities',
    };
  }
}
