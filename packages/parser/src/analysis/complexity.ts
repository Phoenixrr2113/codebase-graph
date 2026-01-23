/**
 * Complexity Metrics Calculator
 * Calculates cyclomatic complexity, cognitive complexity, and nesting depth
 * Based on CodeGraph v2 Specification
 */

import Parser from 'tree-sitter';

// ============================================================================
// Types
// ============================================================================

/** Complexity metrics for a function */
export interface ComplexityMetrics {
  /** Cyclomatic complexity: 1 + decision points */
  cyclomatic: number;
  /** Cognitive complexity: flow breaks + nesting penalties */
  cognitive: number;
  /** Maximum nesting depth of blocks */
  nestingDepth: number;
}

/** Thresholds for complexity classification */
export const COMPLEXITY_THRESHOLDS = {
  cyclomatic: {
    low: 10,
    medium: 20,
    high: 50,
  },
  cognitive: {
    low: 15,
    medium: 30,
  },
  nesting: {
    acceptable: 4,
    warning: 6,
  },
} as const;

// ============================================================================
// Node Type Sets (for TypeScript/JavaScript)
// ============================================================================

/**
 * Node types that represent decision points for cyclomatic complexity
 * Formula: 1 + count(if, else if, case, for, while, &&, ||, try, catch, ?:)
 */
const DECISION_POINT_TYPES = new Set([
  // Conditionals
  'if_statement',
  'else_clause',
  // Loops
  'for_statement',
  'for_in_statement',
  'while_statement',
  'do_statement',
  // Switch
  'switch_case',
  // Exception handling
  'catch_clause',
  // Ternary
  'ternary_expression',
  'conditional_expression',
]);

/**
 * Binary operators that add to cyclomatic complexity
 */
const LOGICAL_OPERATORS = new Set(['&&', '||', '??']);

/**
 * Node types that represent breaks in linear flow for cognitive complexity
 * Each adds +1 to cognitive complexity
 */
const FLOW_BREAK_TYPES = new Set([
  // Conditionals
  'if_statement',
  'else_clause',
  // Loops
  'for_statement',
  'for_in_statement',
  'while_statement',
  'do_statement',
  // Switch
  'switch_case',
  // Exception handling
  'catch_clause',
  // Ternary
  'ternary_expression',
  'conditional_expression',
  // Jump statements
  'break_statement',
  'continue_statement',
]);

/**
 * Node types that increase nesting level
 */
const NESTING_TYPES = new Set([
  'if_statement',
  'for_statement',
  'for_in_statement',
  'while_statement',
  'do_statement',
  'switch_statement',
  'try_statement',
  'catch_clause',
  'arrow_function',
  'function_expression',
]);

// ============================================================================
// Complexity Calculator
// ============================================================================

/**
 * Calculate all complexity metrics for a function node
 */
export function calculateComplexity(functionNode: Parser.SyntaxNode): ComplexityMetrics {
  const cyclomatic = calculateCyclomatic(functionNode);
  const cognitive = calculateCognitive(functionNode);
  const nestingDepth = calculateNestingDepth(functionNode);

  return { cyclomatic, cognitive, nestingDepth };
}

/**
 * Calculate cyclomatic complexity
 * Formula: 1 + count of decision points
 */
export function calculateCyclomatic(node: Parser.SyntaxNode): number {
  let complexity = 1; // Base complexity

  function walk(n: Parser.SyntaxNode): void {
    // Count decision point node types
    if (DECISION_POINT_TYPES.has(n.type)) {
      complexity++;
    }

    // Count logical operators in binary expressions
    if (n.type === 'binary_expression') {
      const operator = n.childForFieldName('operator');
      if (operator && LOGICAL_OPERATORS.has(operator.text)) {
        complexity++;
      }
    }

    // Recurse into children
    for (const child of n.children) {
      walk(child);
    }
  }

  // Walk the function body
  const body = node.childForFieldName('body');
  if (body) {
    walk(body);
  } else {
    // For arrow functions without block body, walk the whole node
    walk(node);
  }

  return complexity;
}

/**
 * Calculate cognitive complexity
 * Rules:
 * - +1 for each break in linear flow
 * - +1 for each nesting level (cumulative per nested construct)
 * - +1 for each boolean sequence (&&, ||)
 */
export function calculateCognitive(node: Parser.SyntaxNode): number {
  let cognitive = 0;

  function walk(n: Parser.SyntaxNode, nestingLevel: number): void {
    // Check for flow breaks
    if (FLOW_BREAK_TYPES.has(n.type)) {
      // +1 base for the construct
      cognitive += 1;
      // +nestingLevel for how deep we are (cumulative penalty)
      cognitive += nestingLevel;
    }

    // Count logical operators
    if (n.type === 'binary_expression') {
      const operator = n.childForFieldName('operator');
      if (operator && LOGICAL_OPERATORS.has(operator.text)) {
        cognitive++;
      }
    }

    // Determine if this node increases nesting for children
    const increasesNesting = NESTING_TYPES.has(n.type);
    const childNesting = increasesNesting ? nestingLevel + 1 : nestingLevel;

    // Recurse into children
    for (const child of n.children) {
      walk(child, childNesting);
    }
  }

  // Walk the function body starting at nesting level 0
  const body = node.childForFieldName('body');
  if (body) {
    walk(body, 0);
  } else {
    walk(node, 0);
  }

  return cognitive;
}

/**
 * Calculate maximum nesting depth
 */
export function calculateNestingDepth(node: Parser.SyntaxNode): number {
  let maxDepth = 0;

  function walk(n: Parser.SyntaxNode, currentDepth: number): void {
    // Check if this node increases nesting
    if (NESTING_TYPES.has(n.type)) {
      currentDepth++;
      if (currentDepth > maxDepth) {
        maxDepth = currentDepth;
      }
    }

    // Recurse into children
    for (const child of n.children) {
      walk(child, currentDepth);
    }
  }

  const body = node.childForFieldName('body');
  if (body) {
    walk(body, 0);
  } else {
    walk(node, 0);
  }

  return maxDepth;
}

/**
 * Classify complexity level based on thresholds
 */
export function classifyComplexity(
  metrics: ComplexityMetrics
): 'low' | 'medium' | 'high' | 'critical' {
  if (metrics.cyclomatic > COMPLEXITY_THRESHOLDS.cyclomatic.high) {
    return 'critical';
  }
  if (
    metrics.cyclomatic > COMPLEXITY_THRESHOLDS.cyclomatic.medium ||
    metrics.cognitive > COMPLEXITY_THRESHOLDS.cognitive.medium
  ) {
    return 'high';
  }
  if (
    metrics.cyclomatic > COMPLEXITY_THRESHOLDS.cyclomatic.low ||
    metrics.cognitive > COMPLEXITY_THRESHOLDS.cognitive.low
  ) {
    return 'medium';
  }
  return 'low';
}
