/**
 * Universal Complexity Analyzer — Language-agnostic complexity metrics
 *
 * Computes cyclomatic complexity, cognitive complexity, and nesting depth
 * for any language supported by tree-sitter. Uses a unified node-type mapping
 * so one implementation covers TypeScript, Python, Java, Go, Rust, C#, and PHP.
 *
 * The mapping is based on empirical tree-sitter grammar analysis:
 * - Most grammars use `if_statement`, `for_statement`, `while_statement`
 * - Python uses `elif_clause`, `boolean_operator` (and/or), `with_statement`
 * - Rust uses `*_expression` variants, `match_expression`, `loop_expression`
 * - Go uses `select_statement`, `communication_case`, `defer_statement`
 * - Java/C#/PHP use `switch_label`/`switch_section`/`case_statement`
 */

import type { SyntaxNode } from '@codegraph/types';

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
// Universal Node Type Mappings
// ============================================================================

/**
 * Decision points that add to cyclomatic complexity.
 * Covers all 7 supported languages' tree-sitter grammars.
 */
const DECISION_POINT_TYPES = new Set([
  // Conditionals — shared across all languages
  'if_statement',
  'else_clause',
  // Python: elif is a separate node type
  'elif_clause',
  // Rust: if is an expression
  'if_expression',

  // Loops
  'for_statement',
  'for_in_statement',     // JS/TS for-in/for-of
  'for_expression',       // Rust
  'foreach_statement',    // C#, PHP
  'while_statement',
  'while_expression',     // Rust
  'do_statement',
  'loop_expression',      // Rust infinite loop

  // Switch/match cases
  'switch_case',          // JS/TS
  'switch_label',         // Java
  'switch_section',       // C#
  'case_statement',       // PHP
  'match_arm',            // Rust

  // Exception handling
  'catch_clause',
  'except_clause',        // Python

  // Ternary/conditional expressions
  'ternary_expression',
  'conditional_expression',

  // Go-specific
  'communication_case',   // Go select case
  'default_case',         // Go select/switch default
]);

/**
 * Node types that represent breaks in linear flow for cognitive complexity.
 * Superset of decision points + jump statements.
 */
const FLOW_BREAK_TYPES = new Set([
  // All decision points
  ...DECISION_POINT_TYPES,

  // Jump statements — all languages
  'break_statement',
  'continue_statement',
  // Rust variants
  'break_expression',
  'continue_expression',
]);

/**
 * Node types that increase nesting level.
 * Control structures + nested function/closure definitions.
 */
const NESTING_TYPES = new Set([
  // Conditionals
  'if_statement',
  'if_expression',        // Rust

  // Loops
  'for_statement',
  'for_in_statement',
  'for_expression',       // Rust
  'foreach_statement',    // C#, PHP
  'while_statement',
  'while_expression',     // Rust
  'do_statement',
  'loop_expression',      // Rust

  // Switch/match
  'switch_statement',
  'switch_expression',    // Java 14+
  'match_expression',     // Rust

  // Exception handling
  'try_statement',
  'catch_clause',
  'except_clause',        // Python
  'with_statement',       // Python

  // Go-specific
  'select_statement',

  // Nested functions/closures (all languages)
  'arrow_function',       // JS/TS
  'function_expression',  // JS/TS
  'lambda',               // Python
  'lambda_expression',    // Java, C#
  'closure_expression',   // Rust
  'func_literal',         // Go
]);

/**
 * Binary/logical operator node types per language.
 * These need child inspection to check the operator text.
 */
const BINARY_EXPR_TYPES = new Set([
  'binary_expression',    // JS/TS, Java, Go, Rust, PHP, C#
  'boolean_operator',     // Python (uses 'and'/'or' instead of &&/||)
]);

/**
 * Operator texts that count as logical operators across languages.
 */
const LOGICAL_OPERATORS = new Set([
  '&&', '||', '??',      // JS/TS, Java, C#, PHP, Go, Rust
  'and', 'or',           // Python
]);

// ============================================================================
// Complexity Calculator
// ============================================================================

/**
 * Calculate all complexity metrics for a function node in a single AST walk.
 * Works with any tree-sitter grammar — uses universal node type mappings.
 */
export function calculateComplexity(functionNode: SyntaxNode): ComplexityMetrics {
  let cyclomatic = 1; // Base complexity
  let cognitive = 0;
  let maxNestingDepth = 0;

  function walk(node: SyntaxNode, nestingLevel: number): void {
    const nodeType = node.type;

    // --- Cyclomatic: count decision points ---
    if (DECISION_POINT_TYPES.has(nodeType)) {
      cyclomatic++;
    }

    // --- Cognitive: count flow breaks + nesting penalty ---
    if (FLOW_BREAK_TYPES.has(nodeType)) {
      cognitive += 1 + nestingLevel;
    }

    // --- Logical operators: count for both cyclomatic and cognitive ---
    if (BINARY_EXPR_TYPES.has(nodeType)) {
      // For binary_expression: check the operator child field
      const operator = node.childForFieldName('operator');
      if (operator && LOGICAL_OPERATORS.has(operator.text)) {
        cyclomatic++;
        cognitive++;
      }
      // For Python boolean_operator: the operator is a direct child node
      // with type 'and' or 'or' — check children directly
      if (nodeType === 'boolean_operator') {
        for (const child of node.children) {
          if (child.type === 'and' || child.type === 'or') {
            cyclomatic++;
            cognitive++;
          }
        }
      }
    }

    // --- Nesting depth: track for children ---
    const pushesNesting = NESTING_TYPES.has(nodeType);
    const childNesting = pushesNesting ? nestingLevel + 1 : nestingLevel;
    if (pushesNesting && childNesting > maxNestingDepth) {
      maxNestingDepth = childNesting;
    }

    // Recurse into children
    for (const child of node.children) {
      walk(child, childNesting);
    }
  }

  // Walk the function body (or the whole node for arrow functions)
  const body = functionNode.childForFieldName('body') ?? functionNode;
  walk(body, 0);

  return { cyclomatic, cognitive, nestingDepth: maxNestingDepth };
}

/**
 * Calculate cyclomatic complexity only.
 * Formula: 1 + count of decision points + logical operators
 */
export function calculateCyclomatic(node: SyntaxNode): number {
  return calculateComplexity(node).cyclomatic;
}

/**
 * Calculate cognitive complexity only.
 * Rules: +1 for each flow break, +nestingLevel penalty per break.
 */
export function calculateCognitive(node: SyntaxNode): number {
  return calculateComplexity(node).cognitive;
}

/**
 * Calculate maximum nesting depth only.
 */
export function calculateNestingDepth(node: SyntaxNode): number {
  return calculateComplexity(node).nestingDepth;
}

/**
 * Classify complexity level based on thresholds.
 */
export function classifyComplexity(
  metrics: ComplexityMetrics,
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
