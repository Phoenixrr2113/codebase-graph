/**
 * Refactoring Analysis Module
 * Analyzes files for extraction opportunities and coupling metrics
 * Based on CodeGraph v2 Specification
 */

// ============================================================================
// Types
// ============================================================================

/** Coupling metrics for a function */
export interface FunctionCoupling {
  /** Function name */
  name: string;
  /** File containing the function */
  file: string;
  /** Start line of the function */
  startLine: number;
  /** End line of the function */
  endLine: number;
  /** Number of calls to functions in the same file */
  internalCalls: number;
  /** Number of reads from file-scoped variables */
  stateReads: number;
  /** Calculated coupling score */
  couplingScore: number;
  /** Whether this function is a candidate for extraction */
  isExtractionCandidate: boolean;
}

/** Responsibility detected within a file */
export interface Responsibility {
  /** Name/description of the responsibility */
  name: string;
  /** Functions belonging to this responsibility */
  functions: string[];
  /** Suggested extraction order (1 = first) */
  extractionOrder: number;
}

/** Result of refactoring analysis for a file */
export interface RefactoringAnalysisResult {
  /** File being analyzed */
  file: string;
  /** Total number of functions in the file */
  totalFunctions: number;
  /** All functions with their coupling metrics */
  functions: FunctionCoupling[];
  /** Functions safe to extract (couplingScore < threshold) */
  extractionCandidates: FunctionCoupling[];
  /** Detected responsibilities/groupings */
  responsibilities: Responsibility[];
  /** Average coupling score for the file */
  averageCouplingScore: number;
  /** Highest coupling score in the file */
  maxCouplingScore: number;
  /** File coupling classification */
  couplingLevel: 'low' | 'medium' | 'high';
}

/** Options for refactoring analysis */
export interface RefactoringAnalysisOptions {
  /** Threshold below which a function is considered for extraction */
  extractionThreshold?: number;
  /** Whether to compute responsibilities */
  detectResponsibilities?: boolean;
}

/** Input data for refactoring analysis (from graph queries) */
export interface RefactoringAnalysisInput {
  /** File path */
  file: string;
  /** Functions in the file with their coupling data */
  functions: Array<{
    name: string;
    startLine: number;
    endLine: number;
    internalCalls: number;
    stateReads: number;
  }>;
  /** Optional: call relationships between functions in the file */
  callRelationships?: Array<{
    caller: string;
    callee: string;
  }>;
}

// ============================================================================
// Constants
// ============================================================================

/** Default threshold for extraction candidates */
export const DEFAULT_EXTRACTION_THRESHOLD = 3;

/** Coupling level thresholds */
export const COUPLING_THRESHOLDS = {
  low: 3,
  medium: 6,
} as const;

// ============================================================================
// Refactoring Analysis Functions
// ============================================================================

/**
 * Analyze a file for refactoring opportunities
 */
export function analyzeRefactoring(
  input: RefactoringAnalysisInput,
  options: RefactoringAnalysisOptions = {}
): RefactoringAnalysisResult {
  const { 
    extractionThreshold = DEFAULT_EXTRACTION_THRESHOLD,
    detectResponsibilities = true,
  } = options;

  // Calculate coupling for each function
  const functions: FunctionCoupling[] = input.functions.map(fn => {
    const couplingScore = fn.internalCalls + fn.stateReads;
    return {
      name: fn.name,
      file: input.file,
      startLine: fn.startLine,
      endLine: fn.endLine,
      internalCalls: fn.internalCalls,
      stateReads: fn.stateReads,
      couplingScore,
      isExtractionCandidate: couplingScore < extractionThreshold,
    };
  });

  // Find extraction candidates (sorted by coupling score, lowest first)
  const extractionCandidates = functions
    .filter(fn => fn.isExtractionCandidate)
    .sort((a, b) => a.couplingScore - b.couplingScore);

  // Calculate aggregate metrics
  const totalFunctions = functions.length;
  const averageCouplingScore = totalFunctions > 0
    ? functions.reduce((sum, fn) => sum + fn.couplingScore, 0) / totalFunctions
    : 0;
  const maxCouplingScore = totalFunctions > 0
    ? Math.max(...functions.map(fn => fn.couplingScore))
    : 0;

  // Classify overall file coupling level
  const couplingLevel = classifyCouplingLevel(averageCouplingScore);

  // Detect responsibilities if requested
  const responsibilities = detectResponsibilities && input.callRelationships
    ? detectFunctionResponsibilities(functions, input.callRelationships)
    : [];

  return {
    file: input.file,
    totalFunctions,
    functions,
    extractionCandidates,
    responsibilities,
    averageCouplingScore,
    maxCouplingScore,
    couplingLevel,
  };
}

/**
 * Classify coupling level based on average score
 */
export function classifyCouplingLevel(
  averageScore: number
): 'low' | 'medium' | 'high' {
  if (averageScore <= COUPLING_THRESHOLDS.low) return 'low';
  if (averageScore <= COUPLING_THRESHOLDS.medium) return 'medium';
  return 'high';
}

/**
 * Calculate coupling score for a single function
 */
export function calculateCouplingScore(
  internalCalls: number,
  stateReads: number
): number {
  return internalCalls + stateReads;
}

/**
 * Check if a function is safe to extract based on coupling
 */
export function isSafeToExtract(
  couplingScore: number,
  threshold: number = DEFAULT_EXTRACTION_THRESHOLD
): boolean {
  return couplingScore < threshold;
}

// ============================================================================
// Responsibility Detection
// ============================================================================

/**
 * Detect responsibilities/groupings within a file based on call relationships
 */
function detectFunctionResponsibilities(
  functions: FunctionCoupling[],
  callRelationships: Array<{ caller: string; callee: string }>
): Responsibility[] {
  // Build adjacency list
  const adjacency = new Map<string, Set<string>>();
  
  for (const fn of functions) {
    if (!adjacency.has(fn.name)) {
      adjacency.set(fn.name, new Set());
    }
  }
  
  for (const rel of callRelationships) {
    if (adjacency.has(rel.caller)) {
      adjacency.get(rel.caller)!.add(rel.callee);
    }
    if (adjacency.has(rel.callee)) {
      adjacency.get(rel.callee)!.add(rel.caller);
    }
  }

  // Find connected components (simple grouping)
  const visited = new Set<string>();
  const responsibilities: Responsibility[] = [];
  let groupIndex = 0;

  for (const fn of functions) {
    if (!visited.has(fn.name)) {
      const component: string[] = [];
      depthFirstSearch(fn.name, adjacency, visited, component);
      
      if (component.length > 0) {
        groupIndex++;
        responsibilities.push({
          name: `responsibility_${groupIndex}`,
          functions: component,
          extractionOrder: groupIndex,
        });
      }
    }
  }

  // Sort by size (smaller groups are easier to extract first)
  responsibilities.sort((a, b) => a.functions.length - b.functions.length);
  responsibilities.forEach((r, i) => r.extractionOrder = i + 1);

  return responsibilities;
}

/**
 * DFS helper for finding connected components
 */
function depthFirstSearch(
  node: string,
  adjacency: Map<string, Set<string>>,
  visited: Set<string>,
  component: string[]
): void {
  if (visited.has(node)) return;
  visited.add(node);
  component.push(node);
  
  const neighbors = adjacency.get(node);
  if (neighbors) {
    for (const neighbor of neighbors) {
      depthFirstSearch(neighbor, adjacency, visited, component);
    }
  }
}

// ============================================================================
// Cypher Query Generators
// ============================================================================

/**
 * Generate Cypher query to get extraction candidates for a file
 */
export function getExtractionCandidatesQuery(filePath: string): string {
  return `
    MATCH (file:File {path: "${filePath}"})-[:CONTAINS]->(fn:Function)
    OPTIONAL MATCH (fn)-[:CALLS]->(internal:Function)
    WHERE internal.file = file.path
    OPTIONAL MATCH (fn)-[:READS]->(v:Variable)
    WHERE v.file = file.path
    WITH fn, count(DISTINCT internal) as internalCalls, 
         count(DISTINCT v) as stateReads
    RETURN fn.name as name, fn.startLine as startLine, fn.endLine as endLine,
           internalCalls, stateReads,
           internalCalls + stateReads as couplingScore
    ORDER BY couplingScore ASC
  `.trim();
}

/**
 * Generate Cypher query to get call relationships within a file
 */
export function getInternalCallsQuery(filePath: string): string {
  return `
    MATCH (file:File {path: "${filePath}"})-[:CONTAINS]->(caller:Function)
    MATCH (caller)-[:CALLS]->(callee:Function)
    WHERE callee.file = file.path
    RETURN caller.name as caller, callee.name as callee
  `.trim();
}

// ============================================================================
// Utility Functions
// ============================================================================

/**
 * Get functions sorted by extraction priority (lowest coupling first)
 */
export function getExtractionOrder(functions: FunctionCoupling[]): FunctionCoupling[] {
  return [...functions]
    .filter(fn => fn.isExtractionCandidate)
    .sort((a, b) => a.couplingScore - b.couplingScore);
}

/**
 * Get a summary of refactoring analysis
 */
export function getRefactoringSummary(result: RefactoringAnalysisResult): string {
  const parts: string[] = [];
  
  parts.push(`File: ${result.file}`);
  parts.push(`Total functions: ${result.totalFunctions}`);
  parts.push(`Extraction candidates: ${result.extractionCandidates.length}`);
  parts.push(`Average coupling: ${result.averageCouplingScore.toFixed(1)}`);
  parts.push(`Coupling level: ${result.couplingLevel.toUpperCase()}`);
  
  if (result.extractionCandidates.length > 0) {
    parts.push(`\nRecommended extraction order:`);
    result.extractionCandidates.forEach((fn, i) => {
      parts.push(`  ${i + 1}. ${fn.name} (score: ${fn.couplingScore})`);
    });
  }
  
  return parts.join('\n');
}

/**
 * Check if a file needs refactoring based on metrics
 */
export function needsRefactoring(result: RefactoringAnalysisResult): boolean {
  return (
    result.couplingLevel === 'high' ||
    result.totalFunctions > 15 ||
    result.averageCouplingScore > COUPLING_THRESHOLDS.medium
  );
}
