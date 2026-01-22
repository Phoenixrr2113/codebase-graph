/**
 * Impact Analysis Module
 * Analyzes what code is affected by changing a symbol
 * Based on CodeGraph v2 Specification
 */

// ============================================================================
// Types
// ============================================================================

/** Information about a caller of a function */
export interface CallerInfo {
  /** Name of the calling function */
  name: string;
  /** File containing the caller */
  file: string;
  /** Depth in call chain (1 = direct caller) */
  depth: number;
}

/** Information about a test file */
export interface TestInfo {
  /** Name of the test function */
  name: string;
  /** File containing the test */
  file: string;
}

/** Result of impact analysis */
export interface ImpactAnalysisResult {
  /** Target symbol being analyzed */
  target: {
    name: string;
    file: string;
  };
  /** Direct callers (depth = 1) */
  directCallers: CallerInfo[];
  /** All transitive callers (depth > 1) */
  transitiveCallers: CallerInfo[];
  /** Test files that cover this symbol */
  affectedTests: TestInfo[];
  /** Calculated risk score */
  riskScore: number;
  /** Risk breakdown */
  riskBreakdown: {
    directCallersContribution: number;
    transitiveCallersContribution: number;
    testCoverageContribution: number;
    complexityContribution: number;
  };
  /** Risk level classification */
  riskLevel: 'low' | 'medium' | 'high' | 'critical';
  /** Whether the symbol has test coverage */
  hasTestCoverage: boolean;
}

/** Options for impact analysis */
export interface ImpactAnalysisOptions {
  /** Maximum depth for transitive caller search */
  maxDepth?: number;
  /** Complexity value of the target function (for risk calculation) */
  complexity?: number;
  /** Whether to include transitive callers in analysis */
  includeTransitive?: boolean;
}

/** Input data for impact analysis (from graph queries) */
export interface ImpactAnalysisInput {
  /** Target symbol information */
  target: {
    name: string;
    file: string;
    complexity?: number;
  };
  /** All callers from graph query (with depth) */
  callers: Array<{
    name: string;
    file: string;
    depth: number;
  }>;
  /** Test files from graph query */
  tests: Array<{
    name: string;
    file: string;
  }>;
}

// ============================================================================
// Risk Calculation Constants
// ============================================================================

/** Weights for risk calculation */
export const RISK_WEIGHTS = {
  /** Multiplier for direct callers */
  directCallerWeight: 2,
  /** Multiplier for transitive callers */
  transitiveCallerWeight: 0.5,
  /** Penalty for no test coverage */
  noTestCoveragePenalty: 10,
  /** Penalty for high complexity (> 20) */
  highComplexityPenalty: 5,
  /** Complexity threshold for penalty */
  complexityThreshold: 20,
} as const;

/** Risk level thresholds */
export const RISK_THRESHOLDS = {
  low: 5,
  medium: 15,
  high: 30,
} as const;

// ============================================================================
// Impact Analysis Functions
// ============================================================================

/**
 * Analyze the impact of changing a symbol
 * 
 * @param input - Input data from graph queries
 * @param options - Analysis options
 * @returns Impact analysis result with risk assessment
 */
export function analyzeImpact(
  input: ImpactAnalysisInput,
  options: ImpactAnalysisOptions = {}
): ImpactAnalysisResult {
  const { maxDepth = 5, includeTransitive = true } = options;
  const complexity = input.target.complexity ?? options.complexity ?? 0;

  // Separate direct and transitive callers
  const directCallers = input.callers.filter(c => c.depth === 1);
  const transitiveCallers = includeTransitive
    ? input.callers.filter(c => c.depth > 1 && c.depth <= maxDepth)
    : [];

  // Check test coverage
  const hasTestCoverage = input.tests.length > 0;

  // Calculate risk components
  const directCallersContribution = 
    directCallers.length * RISK_WEIGHTS.directCallerWeight;
  const transitiveCallersContribution = 
    transitiveCallers.length * RISK_WEIGHTS.transitiveCallerWeight;
  const testCoverageContribution = 
    hasTestCoverage ? 0 : RISK_WEIGHTS.noTestCoveragePenalty;
  const complexityContribution = 
    complexity > RISK_WEIGHTS.complexityThreshold 
      ? RISK_WEIGHTS.highComplexityPenalty 
      : 0;

  // Total risk score
  const riskScore = 
    directCallersContribution +
    transitiveCallersContribution +
    testCoverageContribution +
    complexityContribution;

  // Classify risk level
  const riskLevel = classifyRisk(riskScore);

  return {
    target: {
      name: input.target.name,
      file: input.target.file,
    },
    directCallers,
    transitiveCallers,
    affectedTests: input.tests,
    riskScore,
    riskBreakdown: {
      directCallersContribution,
      transitiveCallersContribution,
      testCoverageContribution,
      complexityContribution,
    },
    riskLevel,
    hasTestCoverage,
  };
}

/**
 * Classify risk level based on score
 */
export function classifyRisk(
  score: number
): 'low' | 'medium' | 'high' | 'critical' {
  if (score <= RISK_THRESHOLDS.low) return 'low';
  if (score <= RISK_THRESHOLDS.medium) return 'medium';
  if (score <= RISK_THRESHOLDS.high) return 'high';
  return 'critical';
}

/**
 * Calculate just the risk score without full analysis
 */
export function calculateRiskScore(
  directCallerCount: number,
  transitiveCallerCount: number,
  hasTestCoverage: boolean,
  complexity: number
): number {
  const directContribution = directCallerCount * RISK_WEIGHTS.directCallerWeight;
  const transitiveContribution = transitiveCallerCount * RISK_WEIGHTS.transitiveCallerWeight;
  const testContribution = hasTestCoverage ? 0 : RISK_WEIGHTS.noTestCoveragePenalty;
  const complexityContribution = 
    complexity > RISK_WEIGHTS.complexityThreshold 
      ? RISK_WEIGHTS.highComplexityPenalty 
      : 0;

  return directContribution + transitiveContribution + testContribution + complexityContribution;
}

// ============================================================================
// Cypher Query Generators
// ============================================================================

/**
 * Generate Cypher query for direct callers
 */
export function getDirectCallersQuery(symbolName: string): string {
  return `
    MATCH (target:Function {name: "${symbolName}"})<-[:CALLS]-(caller:Function)
    RETURN caller.name as name, caller.file as file, 1 as depth
  `.trim();
}

/**
 * Generate Cypher query for transitive callers
 */
export function getTransitiveCallersQuery(
  symbolName: string, 
  maxDepth: number = 5
): string {
  return `
    MATCH path = (target:Function {name: "${symbolName}"})<-[:CALLS*1..${maxDepth}]-(caller:Function)
    RETURN DISTINCT caller.name as name, caller.file as file, length(path) as depth
    ORDER BY depth
  `.trim();
}

/**
 * Generate Cypher query for affected tests
 */
export function getAffectedTestsQuery(symbolName: string): string {
  return `
    MATCH (target:Function {name: "${symbolName}"})<-[:CALLS*]-(test:Function)
    WHERE test.file CONTAINS '.test.' OR test.file CONTAINS '.spec.'
    RETURN DISTINCT test.name as name, test.file as file
  `.trim();
}

// ============================================================================
// Utility Functions
// ============================================================================

/**
 * Check if a file path indicates a test file
 */
export function isTestFile(filePath: string): boolean {
  const testPatterns = [
    /\.test\.[jt]sx?$/,
    /\.spec\.[jt]sx?$/,
    /__tests__\//,
    /\/tests?\//,
    /\.tests?\.[jt]sx?$/,
  ];
  return testPatterns.some(pattern => pattern.test(filePath));
}

/**
 * Get unique files from caller list
 */
export function getAffectedFiles(callers: CallerInfo[]): string[] {
  return [...new Set(callers.map(c => c.file))];
}

/**
 * Group callers by file
 */
export function groupCallersByFile(
  callers: CallerInfo[]
): Map<string, CallerInfo[]> {
  const grouped = new Map<string, CallerInfo[]>();
  for (const caller of callers) {
    const existing = grouped.get(caller.file) || [];
    existing.push(caller);
    grouped.set(caller.file, existing);
  }
  return grouped;
}

/**
 * Get summary of impact for display
 */
export function getImpactSummary(result: ImpactAnalysisResult): string {
  const parts: string[] = [];
  
  parts.push(`Target: ${result.target.name}`);
  parts.push(`Risk: ${result.riskLevel.toUpperCase()} (score: ${result.riskScore.toFixed(1)})`);
  parts.push(`Direct callers: ${result.directCallers.length}`);
  parts.push(`Transitive callers: ${result.transitiveCallers.length}`);
  parts.push(`Test coverage: ${result.hasTestCoverage ? 'Yes' : 'No'}`);
  parts.push(`Affected files: ${getAffectedFiles([...result.directCallers, ...result.transitiveCallers]).length}`);
  
  return parts.join('\n');
}
