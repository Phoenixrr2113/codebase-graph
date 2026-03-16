/**
 * MCP Tool: find_vulnerabilities
 *
 * Scan for security vulnerabilities using tree-sitter pattern matching.
 * Delegates to codeGraphService.scanVulnerabilities() for business logic.
 */

import { codeGraphService, getActiveProjectPaths } from '@codegraph/core';
import type { ToolDefinition } from './consolidated';

// Input schema
export interface FindVulnerabilitiesInput {
  scope?: string;
  severity?: 'critical' | 'high' | 'medium' | 'low' | 'all';
  category?: 'injection' | 'xss' | 'auth' | 'all';
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
        enum: ['injection', 'xss', 'auth', 'all'],
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
    const severity = input.severity ?? 'all';
    const category = input.category ?? 'all';

    // Resolve scope: use active project paths when scope is 'all' or unset
    let scopePaths: string[];
    if (!input.scope || input.scope === 'all') {
      const activePaths = await getActiveProjectPaths();
      scopePaths = activePaths.length > 0 ? activePaths : [process.cwd()];
    } else {
      scopePaths = [input.scope];
    }

    // Scan all scope paths and merge results
    let allVulnerabilities: Vulnerability[] = [];
    let totalFilesScanned = 0;

    for (const scopePath of scopePaths) {
      const scanOpts: Parameters<typeof codeGraphService.scanVulnerabilities>[0] = { path: scopePath };
      if (category !== 'all') scanOpts.category = category;

      const result = await codeGraphService.scanVulnerabilities(scanOpts);
      totalFilesScanned += result.filesScanned;

      allVulnerabilities.push(...result.vulnerabilities.map(v => ({
        type: v.type,
        severity: v.severity as 'critical' | 'high' | 'medium' | 'low',
        file: v.filePath,
        line: v.line,
        code: v.code,
        description: v.message,
        fix: v.recommendation,
      })));
    }

    // Filter by minimum severity (service returns all, MCP needs severity filtering)
    if (severity !== 'all') {
      const minSeverity = SEVERITY_RANK[severity] ?? 0;
      allVulnerabilities = allVulnerabilities.filter(
        v => (SEVERITY_RANK[v.severity] ?? 0) >= minSeverity,
      );
    }

    // Calculate summary
    const summary = {
      critical: allVulnerabilities.filter(v => v.severity === 'critical').length,
      high: allVulnerabilities.filter(v => v.severity === 'high').length,
      medium: allVulnerabilities.filter(v => v.severity === 'medium').length,
      low: allVulnerabilities.filter(v => v.severity === 'low').length,
    };

    return {
      vulnerabilities: allVulnerabilities,
      summary,
      filesScanned: totalFilesScanned,
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
