/**
 * Security Pattern Scanner
 * Detects OWASP Top 10 vulnerabilities using tree-sitter pattern matching
 * Based on CodeGraph v2 Specification
 */

import Parser from 'tree-sitter';

// ============================================================================
// Types
// ============================================================================

/** Severity levels for security findings */
export type SecuritySeverity = 'critical' | 'high' | 'medium' | 'low' | 'info';

/** Security finding returned by the scanner */
export interface SecurityFinding {
  /** Type of vulnerability (e.g., 'sql_injection', 'xss') */
  type: string;
  /** Severity level */
  severity: SecuritySeverity;
  /** File path where the issue was found */
  file: string;
  /** Line number of the issue */
  line: number;
  /** Column number of the issue */
  column: number;
  /** Code snippet containing the issue */
  code: string;
  /** Human-readable description of the issue */
  description: string;
  /** Suggested fix */
  fix: string;
}

/** Options for the security scanner */
export interface ScanOptions {
  /** File path being scanned (for finding reports) */
  filePath: string;
  /** Whether to include lower severity findings */
  includeLowSeverity?: boolean;
}

// ============================================================================
// Vulnerability Patterns
// ============================================================================

/**
 * Taint sources - user input that should not flow to dangerous sinks
 */
const TAINT_SOURCES = new Set([
  // Express/Hono request
  'request.body',
  'request.query',
  'request.params',
  'req.body',
  'req.query',
  'req.params',
  'ctx.request.body',
  // Lambda
  'event.body',
  // Environment (potential secrets)
  'process.env',
  // File system
  'fs.readFileSync',
]);

/**
 * SQL Injection patterns
 */
const SQL_INJECTION_PATTERNS = {
  methods: new Set([
    'query',
    'execute',
    'raw',
    '$queryRaw',
    '$executeRaw',
    'rawQuery',
  ]),
  dangerousUsage: [
    // Template literals in queries
    /`.*\$\{.*\}.*`/,
    // String concatenation
    /\+.*['"]/,
  ],
};

/**
 * XSS patterns
 */
const XSS_PATTERNS = {
  properties: new Set([
    'innerHTML',
    'outerHTML',
  ]),
  methods: new Set([
    'document.write',
    'document.writeln',
  ]),
  jsxProperties: new Set([
    'dangerouslySetInnerHTML',
  ]),
};

/**
 * Command Injection patterns
 */
const COMMAND_INJECTION_PATTERNS = {
  methods: new Set([
    'exec',
    'execSync',
    'spawn',
    'spawnSync',
    'execFile',
    'execFileSync',
  ]),
  modules: new Set([
    'child_process',
  ]),
};

/**
 * Path Traversal patterns
 */
const PATH_TRAVERSAL_PATTERNS = {
  methods: new Set([
    'readFile',
    'readFileSync',
    'writeFile',
    'writeFileSync',
    'createReadStream',
    'createWriteStream',
    'open',
    'openSync',
    'access',
    'accessSync',
  ]),
};

/**
 * Hardcoded secrets patterns
 */
const SECRET_PATTERNS = [
  // API keys
  /['"](?:api[_-]?key|apikey)['"]\s*[:=]\s*['"][^'"]{16,}['"]/i,
  /['"](?:secret|api[_-]?secret)['"]\s*[:=]\s*['"][^'"]{16,}['"]/i,
  // AWS
  /['"]AKIA[0-9A-Z]{16}['"]/,
  // Stripe
  /['"]sk_(?:live|test)_[a-zA-Z0-9]{24,}['"]/,
  // Private keys
  /['"]-----BEGIN (?:RSA |DSA |EC )?PRIVATE KEY-----/,
  // Password assignments
  /(?:password|passwd|pwd)\s*[:=]\s*['"][^'"]{4,}['"]/i,
  // JWT tokens
  /['"]eyJ[a-zA-Z0-9_-]*\.eyJ[a-zA-Z0-9_-]*\.[a-zA-Z0-9_-]*['"]/,
];

/**
 * Eval patterns
 */
const EVAL_PATTERNS = {
  functions: new Set([
    'eval',
    'Function',
    'setTimeout', // when called with string
    'setInterval', // when called with string
  ]),
};

// ============================================================================
// Security Scanner
// ============================================================================

/**
 * Scan an AST node for security vulnerabilities
 */
export function scanForVulnerabilities(
  rootNode: Parser.SyntaxNode,
  options: ScanOptions
): SecurityFinding[] {
  const findings: SecurityFinding[] = [];
  const { filePath, includeLowSeverity = true } = options;

  // Walk the AST and check for patterns
  walkNode(rootNode, (node) => {
    // Check for SQL Injection
    const sqlFindings = checkSqlInjection(node, filePath);
    findings.push(...sqlFindings);

    // Check for XSS
    const xssFindings = checkXss(node, filePath);
    findings.push(...xssFindings);

    // Check for Command Injection
    const cmdFindings = checkCommandInjection(node, filePath);
    findings.push(...cmdFindings);

    // Check for Path Traversal
    const pathFindings = checkPathTraversal(node, filePath);
    findings.push(...pathFindings);

    // Check for Hardcoded Secrets
    const secretFindings = checkHardcodedSecrets(node, filePath);
    findings.push(...secretFindings);

    // Check for Eval usage
    const evalFindings = checkEval(node, filePath);
    findings.push(...evalFindings);
  });

  // Filter by severity if requested
  if (!includeLowSeverity) {
    return findings.filter(
      (f) => f.severity === 'critical' || f.severity === 'high'
    );
  }

  return findings;
}

/**
 * Walk AST nodes recursively and call visitor for each
 */
function walkNode(
  node: Parser.SyntaxNode,
  visitor: (node: Parser.SyntaxNode) => void
): void {
  visitor(node);
  for (const child of node.children) {
    walkNode(child, visitor);
  }
}

// ============================================================================
// Individual Vulnerability Checkers
// ============================================================================

/**
 * Check for SQL Injection vulnerabilities
 */
function checkSqlInjection(
  node: Parser.SyntaxNode,
  filePath: string
): SecurityFinding[] {
  const findings: SecurityFinding[] = [];

  // Look for call expressions
  if (node.type === 'call_expression') {
    const callee = node.childForFieldName('function');
    if (!callee) return findings;

    // Check if it's a dangerous SQL method
    const calleeText = callee.text;
    const isDbQuery = SQL_INJECTION_PATTERNS.methods.has(getMethodName(calleeText));

    if (isDbQuery) {
      const args = node.childForFieldName('arguments');
      if (args) {
        // Check if arguments contain template literals or concatenation
        for (const arg of args.children) {
          if (arg.type === 'template_string' || arg.type === 'template_literal') {
            // Template literal in query - potential SQLi
            if (hasTemplateExpressions(arg)) {
              findings.push({
                type: 'sql_injection',
                severity: 'critical',
                file: filePath,
                line: node.startPosition.row + 1,
                column: node.startPosition.column,
                code: node.text.slice(0, 100),
                description: 'Potential SQL injection: template literal with interpolation used in query',
                fix: 'Use parameterized queries or prepared statements instead of string interpolation',
              });
            }
          } else if (arg.type === 'binary_expression') {
            // String concatenation in query
            if (isStringConcatenation(arg)) {
              findings.push({
                type: 'sql_injection',
                severity: 'critical',
                file: filePath,
                line: node.startPosition.row + 1,
                column: node.startPosition.column,
                code: node.text.slice(0, 100),
                description: 'Potential SQL injection: string concatenation used in query',
                fix: 'Use parameterized queries or prepared statements instead of string concatenation',
              });
            }
          }
        }
      }
    }
  }

  return findings;
}

/**
 * Check for XSS vulnerabilities
 */
function checkXss(
  node: Parser.SyntaxNode,
  filePath: string
): SecurityFinding[] {
  const findings: SecurityFinding[] = [];

  // Check for innerHTML assignments
  if (node.type === 'assignment_expression') {
    const left = node.childForFieldName('left');
    if (left) {
      const leftText = left.text;
      if (XSS_PATTERNS.properties.has(getPropertyName(leftText))) {
        findings.push({
          type: 'xss',
          severity: 'high',
          file: filePath,
          line: node.startPosition.row + 1,
          column: node.startPosition.column,
          code: node.text.slice(0, 100),
          description: 'Potential XSS: direct assignment to innerHTML',
          fix: 'Use textContent instead, or sanitize HTML with a library like DOMPurify',
        });
      }
    }
  }

  // Check for dangerouslySetInnerHTML in JSX - check multiple JSX node types
  if (
    node.type === 'jsx_attribute' ||
    node.type === 'jsx_expression' ||
    node.type === 'jsx_self_closing_element' ||
    node.type === 'jsx_opening_element' ||
    node.type === 'property_identifier' ||
    node.type === 'identifier'
  ) {
    // Check if the node text IS dangerouslySetInnerHTML (property identifier)
    if (node.text === 'dangerouslySetInnerHTML') {
      findings.push({
        type: 'xss',
        severity: 'high',
        file: filePath,
        line: node.startPosition.row + 1,
        column: node.startPosition.column,
        code: node.parent?.text?.slice(0, 100) || node.text,
        description: 'Potential XSS: dangerouslySetInnerHTML used',
        fix: 'Avoid dangerouslySetInnerHTML if possible, or ensure content is properly sanitized',
      });
    }
    // For larger elements, check if they contain dangerouslySetInnerHTML
    else if (
      node.type !== 'identifier' &&
      node.type !== 'property_identifier' &&
      node.text.includes('dangerouslySetInnerHTML')
    ) {
      findings.push({
        type: 'xss',
        severity: 'high',
        file: filePath,
        line: node.startPosition.row + 1,
        column: node.startPosition.column,
        code: node.text.slice(0, 100),
        description: 'Potential XSS: dangerouslySetInnerHTML used',
        fix: 'Avoid dangerouslySetInnerHTML if possible, or ensure content is properly sanitized',
      });
    }
  }

  // Check for document.write
  if (node.type === 'call_expression') {
    const callee = node.childForFieldName('function');
    if (callee) {
      const calleeText = callee.text;
      if (XSS_PATTERNS.methods.has(calleeText)) {
        findings.push({
          type: 'xss',
          severity: 'high',
          file: filePath,
          line: node.startPosition.row + 1,
          column: node.startPosition.column,
          code: node.text.slice(0, 100),
          description: 'Potential XSS: document.write used',
          fix: 'Use DOM manipulation methods instead of document.write',
        });
      }
    }
  }

  return findings;
}

/**
 * Check for Command Injection vulnerabilities
 */
function checkCommandInjection(
  node: Parser.SyntaxNode,
  filePath: string
): SecurityFinding[] {
  const findings: SecurityFinding[] = [];

  if (node.type === 'call_expression') {
    const callee = node.childForFieldName('function');
    if (!callee) return findings;

    const calleeText = callee.text;
    const methodName = getMethodName(calleeText);

    if (COMMAND_INJECTION_PATTERNS.methods.has(methodName)) {
      const args = node.childForFieldName('arguments');
      if (args) {
        // Get first actual argument (skip parentheses and commas)
        const firstArg = args.children.find(
          (c) => c.type !== '(' && c.type !== ')' && c.type !== ','
        );
        if (firstArg) {
          // Check for template literals, string concatenation, or identifiers with user input
          const isDynamic =
            firstArg.type === 'template_string' ||
            firstArg.type === 'template_literal' ||
            (firstArg.type === 'binary_expression' && isStringConcatenation(firstArg)) ||
            (firstArg.type === 'identifier' && containsTaintSource(node.text));

          if (isDynamic) {
            findings.push({
              type: 'command_injection',
              severity: 'critical',
              file: filePath,
              line: node.startPosition.row + 1,
              column: node.startPosition.column,
              code: node.text.slice(0, 100),
              description: 'Potential command injection: dynamic command construction',
              fix: 'Use execFile with array arguments instead of exec with shell commands',
            });
          }
        }
      }
    }
  }

  return findings;
}

/**
 * Check for Path Traversal vulnerabilities
 */
function checkPathTraversal(
  node: Parser.SyntaxNode,
  filePath: string
): SecurityFinding[] {
  const findings: SecurityFinding[] = [];

  if (node.type === 'call_expression') {
    const callee = node.childForFieldName('function');
    if (!callee) return findings;

    const calleeText = callee.text;
    const methodName = getMethodName(calleeText);

    if (PATH_TRAVERSAL_PATTERNS.methods.has(methodName)) {
      const args = node.childForFieldName('arguments');
      if (args) {
        // Get first actual argument (skip parentheses and commas)
        const firstArg = args.children.find(
          (c) => c.type !== '(' && c.type !== ')' && c.type !== ','
        );
        if (firstArg) {
          // Check if path is constructed dynamically or is a variable
          const isDynamic =
            firstArg.type === 'template_string' ||
            firstArg.type === 'template_literal' ||
            firstArg.type === 'identifier' ||
            (firstArg.type === 'binary_expression' && isStringConcatenation(firstArg)) ||
            (firstArg.type === 'call_expression');

          if (isDynamic) {
            findings.push({
              type: 'path_traversal',
              severity: 'high',
              file: filePath,
              line: node.startPosition.row + 1,
              column: node.startPosition.column,
              code: node.text.slice(0, 100),
              description: 'Potential path traversal: file operation with dynamic path',
              fix: 'Validate and sanitize path input, use path.resolve and check against allowed directories',
            });
          }
        }
      }
    }
  }

  return findings;
}

/**
 * Check for Hardcoded Secrets
 */
function checkHardcodedSecrets(
  node: Parser.SyntaxNode,
  filePath: string
): SecurityFinding[] {
  const findings: SecurityFinding[] = [];

  // Check string literals and template literals
  if (
    node.type === 'string' ||
    node.type === 'string_fragment' ||
    node.type === 'template_string' ||
    node.type === 'template_literal'
  ) {
    const text = node.text;
    for (const pattern of SECRET_PATTERNS) {
      if (pattern.test(text)) {
        findings.push({
          type: 'hardcoded_secret',
          severity: 'critical',
          file: filePath,
          line: node.startPosition.row + 1,
          column: node.startPosition.column,
          code: text.slice(0, 50) + (text.length > 50 ? '...' : ''),
          description: 'Hardcoded secret detected',
          fix: 'Move secrets to environment variables or a secure secrets manager',
        });
        break; // Only report once per node
      }
    }
  }

  // Also check variable declarations
  if (node.type === 'variable_declarator' || node.type === 'assignment_expression') {
    const nodeText = node.text;
    for (const pattern of SECRET_PATTERNS) {
      if (pattern.test(nodeText)) {
        findings.push({
          type: 'hardcoded_secret',
          severity: 'critical',
          file: filePath,
          line: node.startPosition.row + 1,
          column: node.startPosition.column,
          code: nodeText.slice(0, 50) + (nodeText.length > 50 ? '...' : ''),
          description: 'Hardcoded secret detected in variable assignment',
          fix: 'Move secrets to environment variables or a secure secrets manager',
        });
        break;
      }
    }
  }

  return findings;
}

/**
 * Check for Eval usage
 */
function checkEval(
  node: Parser.SyntaxNode,
  filePath: string
): SecurityFinding[] {
  const findings: SecurityFinding[] = [];

  if (node.type === 'call_expression') {
    const callee = node.childForFieldName('function');
    if (!callee) return findings;

    const calleeText = callee.text;
    if (EVAL_PATTERNS.functions.has(calleeText)) {
      // For setTimeout/setInterval, only flag if first arg is a string
      if (calleeText === 'setTimeout' || calleeText === 'setInterval') {
        const args = node.childForFieldName('arguments');
        if (args) {
          // Get first actual argument (skip parentheses and commas)
          const firstArg = args.children.find(
            (c) => c.type !== '(' && c.type !== ')' && c.type !== ','
          );
          // String types in tree-sitter TS: 'string' with quotes inside text
          if (firstArg && (
            firstArg.type === 'string' ||
            firstArg.type === 'template_string' ||
            firstArg.type === 'template_literal' ||
            (firstArg.text.startsWith('"') || firstArg.text.startsWith("'"))
          )) {
            findings.push({
              type: 'eval',
              severity: 'high',
              file: filePath,
              line: node.startPosition.row + 1,
              column: node.startPosition.column,
              code: node.text.slice(0, 100),
              description: `Dangerous ${calleeText} with string argument: acts like eval`,
              fix: `Pass a function reference to ${calleeText} instead of a string`,
            });
          }
        }
      } else {
        findings.push({
          type: 'eval',
          severity: 'high',
          file: filePath,
          line: node.startPosition.row + 1,
          column: node.startPosition.column,
          code: node.text.slice(0, 100),
          description: `Use of ${calleeText}: allows execution of arbitrary code`,
          fix: 'Avoid eval and similar functions; use safer alternatives',
        });
      }
    }
  }

  // Check for new Function()
  if (node.type === 'new_expression') {
    const callee = node.childForFieldName('constructor');
    if (callee && callee.text === 'Function') {
      findings.push({
        type: 'eval',
        severity: 'high',
        file: filePath,
        line: node.startPosition.row + 1,
        column: node.startPosition.column,
        code: node.text.slice(0, 100),
        description: 'Use of new Function(): allows execution of arbitrary code',
        fix: 'Avoid new Function(); use regular functions instead',
      });
    }
  }

  return findings;
}

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Extract method name from call expression text
 * e.g., "db.query" -> "query", "knex.raw" -> "raw"
 */
function getMethodName(text: string): string {
  const parts = text.split('.');
  return parts[parts.length - 1] || text;
}

/**
 * Extract property name from member expression
 * e.g., "element.innerHTML" -> "innerHTML"
 */
function getPropertyName(text: string): string {
  const parts = text.split('.');
  return parts[parts.length - 1] || text;
}

/**
 * Check if a template literal has interpolation expressions
 */
function hasTemplateExpressions(node: Parser.SyntaxNode): boolean {
  for (const child of node.children) {
    if (child.type === 'template_substitution') {
      return true;
    }
  }
  return false;
}

/**
 * Check if a binary expression is string concatenation
 */
function isStringConcatenation(node: Parser.SyntaxNode): boolean {
  if (node.type !== 'binary_expression') return false;
  const operator = node.childForFieldName('operator');
  if (!operator || operator.text !== '+') return false;

  // Check if either operand is a string
  const left = node.childForFieldName('left');
  const right = node.childForFieldName('right');

  const isString = (n: Parser.SyntaxNode | null): boolean =>
    n !== null && (n.type === 'string' || n.type === 'template_string' || n.type === 'string_fragment');

  return isString(left) || isString(right);
}

/**
 * Check if text contains known taint sources
 */
function containsTaintSource(text: string): boolean {
  for (const source of TAINT_SOURCES) {
    if (text.includes(source)) {
      return true;
    }
  }
  return false;
}

// ============================================================================
// Aggregate Functions
// ============================================================================

/**
 * Scan a file's AST for all security vulnerabilities
 * Returns findings grouped by severity
 */
export function scanFile(
  rootNode: Parser.SyntaxNode,
  filePath: string
): {
  findings: SecurityFinding[];
  summary: {
    critical: number;
    high: number;
    medium: number;
    low: number;
    total: number;
  };
} {
  const findings = scanForVulnerabilities(rootNode, { filePath });

  const summary = {
    critical: findings.filter(f => f.severity === 'critical').length,
    high: findings.filter(f => f.severity === 'high').length,
    medium: findings.filter(f => f.severity === 'medium').length,
    low: findings.filter(f => f.severity === 'low').length,
    total: findings.length,
  };

  return { findings, summary };
}

/**
 * Get severity level as numeric value for sorting
 */
export function severityToNumber(severity: SecuritySeverity): number {
  const map: Record<SecuritySeverity, number> = {
    critical: 4,
    high: 3,
    medium: 2,
    low: 1,
    info: 0,
  };
  return map[severity];
}

/**
 * Sort findings by severity (critical first)
 */
export function sortBySeverity(findings: SecurityFinding[]): SecurityFinding[] {
  return [...findings].sort(
    (a, b) => severityToNumber(b.severity) - severityToNumber(a.severity)
  );
}
