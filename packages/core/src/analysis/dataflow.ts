/**
 * Dataflow Analysis Module
 * Track data flow from sources to sinks with taint propagation
 * Based on CodeGraph v2 Specification
 */

import Parser from 'tree-sitter';

// ============================================================================
// Types
// ============================================================================

/** Categories of taint sources */
export type TaintSourceCategory = 'user_input' | 'api_response' | 'file_read' | 'environment';

/** Categories of taint sinks */
export type TaintSinkCategory = 'sql_injection' | 'command_injection' | 'xss' | 'path_traversal';

/** A taint source detected in code */
export interface TaintSource {
  /** Category of the source */
  category: TaintSourceCategory;
  /** Specific pattern that matched */
  pattern: string;
  /** Variable or expression that is tainted */
  taintedVariable: string;
  /** File where source was found */
  file: string;
  /** Line number */
  line: number;
  /** Column number */
  column: number;
}

/** A taint sink detected in code */
export interface TaintSink {
  /** Category of the sink */
  category: TaintSinkCategory;
  /** Specific pattern that matched */
  pattern: string;
  /** The tainted argument flowing into sink */
  taintedArgument: string;
  /** File where sink was found */
  file: string;
  /** Line number */
  line: number;
  /** Column number */
  column: number;
  /** Severity of this sink type */
  severity: 'critical' | 'high' | 'medium';
}

/** A single step in a data flow path */
export interface FlowStep {
  /** Variable or expression at this step */
  name: string;
  /** File path */
  file: string;
  /** Line number */
  line: number;
  /** Transformation applied (assignment, call, return, etc.) */
  transformation: string;
  /** Whether data is tainted at this step */
  tainted: boolean;
  /** Whether data was sanitized at this step */
  sanitized: boolean;
}

/** A complete data flow path from source to sink */
export interface DataFlowPath {
  /** Source of the tainted data */
  source: TaintSource;
  /** Steps in the flow */
  steps: FlowStep[];
  /** Sink where tainted data ends up (if any) */
  sink?: TaintSink;
  /** Whether the path is potentially vulnerable */
  isVulnerable: boolean;
  /** Sanitizers encountered on this path */
  sanitizers: string[];
}

/** Result of dataflow analysis */
export interface DataflowAnalysisResult {
  /** File analyzed */
  file: string;
  /** All taint sources found */
  sources: TaintSource[];
  /** All taint sinks found */
  sinks: TaintSink[];
  /** Data flow paths traced */
  paths: DataFlowPath[];
  /** Potential vulnerabilities (unsanitized source→sink) */
  vulnerabilities: Array<{
    source: TaintSource;
    sink: TaintSink;
    category: TaintSinkCategory;
    severity: 'critical' | 'high' | 'medium';
  }>;
}

/** Options for dataflow analysis */
export interface DataflowAnalysisOptions {
  /** Maximum depth to trace flows */
  maxDepth?: number;
  /** Whether to include detailed flow steps */
  includeSteps?: boolean;
}

// ============================================================================
// Taint Source Patterns
// ============================================================================

/** User input taint sources */
const USER_INPUT_SOURCES = [
  'request.body',
  'request.query',
  'request.params',
  'req.body',
  'req.query',
  'req.params',
  'ctx.request.body',
  'event.body',
  'process.env',
];

/** API response taint sources */
const API_RESPONSE_SOURCES = [
  'response.data',
  'res.data',
  'axios.',
];

/** File read taint sources */
const FILE_READ_SOURCES = [
  'fs.readFileSync',
  'fs.readFile',
  'readFile',
];

/** All taint source patterns with categories */
const TAINT_SOURCES: Array<{ pattern: string; category: TaintSourceCategory }> = [
  ...USER_INPUT_SOURCES.map(p => ({ pattern: p, category: 'user_input' as const })),
  ...API_RESPONSE_SOURCES.map(p => ({ pattern: p, category: 'api_response' as const })),
  ...FILE_READ_SOURCES.map(p => ({ pattern: p, category: 'file_read' as const })),
  { pattern: 'process.env', category: 'environment' },
];

// ============================================================================
// Taint Sink Patterns
// ============================================================================

/** SQL injection sinks */
const SQL_SINKS = [
  { pattern: 'query', method: true },
  { pattern: 'execute', method: true },
  { pattern: 'raw', method: true },
  { pattern: '$queryRaw', method: true },
  { pattern: '$executeRaw', method: true },
];

/** Command injection sinks */
const COMMAND_SINKS = [
  { pattern: 'exec', method: true },
  { pattern: 'execSync', method: true },
  { pattern: 'spawn', method: true },
  { pattern: 'spawnSync', method: true },
];

/** XSS sinks */
const XSS_SINKS = [
  { pattern: 'innerHTML', property: true },
  { pattern: 'outerHTML', property: true },
  { pattern: 'document.write', method: true },
  { pattern: 'dangerouslySetInnerHTML', property: true },
];

/** Path traversal sinks */
const PATH_SINKS = [
  { pattern: 'readFile', method: true },
  { pattern: 'readFileSync', method: true },
  { pattern: 'writeFile', method: true },
  { pattern: 'writeFileSync', method: true },
];

/** All taint sink patterns with categories */
const TAINT_SINKS: Array<{
  patterns: Array<{ pattern: string; method?: boolean; property?: boolean }>;
  category: TaintSinkCategory;
  severity: 'critical' | 'high' | 'medium';
}> = [
    { patterns: SQL_SINKS, category: 'sql_injection', severity: 'critical' },
    { patterns: COMMAND_SINKS, category: 'command_injection', severity: 'critical' },
    { patterns: XSS_SINKS, category: 'xss', severity: 'high' },
    { patterns: PATH_SINKS, category: 'path_traversal', severity: 'high' },
  ];

// ============================================================================
// Known Sanitizers
// ============================================================================

/** Known sanitizer functions/methods */
const SANITIZERS = new Set([
  'escape',
  'escapeHtml',
  'sanitize',
  'sanitizeHtml',
  'encodeURIComponent',
  'encodeURI',
  'htmlEscape',
  'sqlEscape',
  'parameterize',
  'DOMPurify.sanitize',
  'validator.escape',
]);

// ============================================================================
// Dataflow Analysis Functions
// ============================================================================

/**
 * Analyze an AST for dataflow and taint tracking
 */
export function analyzeDataflow(
  rootNode: Parser.SyntaxNode,
  filePath: string,
  options: DataflowAnalysisOptions = {}
): DataflowAnalysisResult {
  const sources: TaintSource[] = [];
  const sinks: TaintSink[] = [];

  // Walk AST to find sources and sinks
  walkNode(rootNode, (node) => {
    // Check for taint sources
    const source = detectTaintSource(node, filePath);
    if (source) {
      sources.push(source);
    }

    // Check for taint sinks
    const sink = detectTaintSink(node, filePath);
    if (sink) {
      sinks.push(sink);
    }
  });

  // Match sources to sinks to find potential vulnerabilities
  const vulnerabilities = findVulnerabilities(sources, sinks, rootNode);

  // Build flow paths if requested
  const paths = options.includeSteps
    ? buildFlowPaths(sources, sinks, rootNode, filePath, options.maxDepth || 10)
    : [];

  return {
    file: filePath,
    sources,
    sinks,
    paths,
    vulnerabilities,
  };
}

/**
 * Walk AST nodes recursively
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

/**
 * Detect if a node is a taint source
 */
function detectTaintSource(
  node: Parser.SyntaxNode,
  filePath: string
): TaintSource | null {
  const nodeText = node.text;

  for (const { pattern, category } of TAINT_SOURCES) {
    if (nodeText.includes(pattern)) {
      // Check if this is a member expression or call that matches
      if (
        node.type === 'member_expression' ||
        node.type === 'call_expression' ||
        node.type === 'identifier'
      ) {
        // Find the variable being assigned the tainted value
        const parent = node.parent;
        let taintedVariable = nodeText;

        if (parent?.type === 'variable_declarator') {
          const nameNode = parent.childForFieldName('name');
          if (nameNode) {
            taintedVariable = nameNode.text;
          }
        } else if (parent?.type === 'assignment_expression') {
          const leftNode = parent.childForFieldName('left');
          if (leftNode) {
            taintedVariable = leftNode.text;
          }
        }

        return {
          category,
          pattern,
          taintedVariable,
          file: filePath,
          line: node.startPosition.row + 1,
          column: node.startPosition.column,
        };
      }
    }
  }

  return null;
}

/**
 * Detect if a node is a taint sink
 */
function detectTaintSink(
  node: Parser.SyntaxNode,
  filePath: string
): TaintSink | null {
  // Check call expressions for method sinks
  if (node.type === 'call_expression') {
    const callee = node.childForFieldName('function');
    if (!callee) return null;

    const calleeText = callee.text;
    const methodName = getMethodName(calleeText);

    for (const { patterns, category, severity } of TAINT_SINKS) {
      for (const { pattern, method } of patterns) {
        if (method && methodName === pattern) {
          // Get the arguments to check for taint
          const args = node.childForFieldName('arguments');
          const taintedArg = args?.text || '';

          return {
            category,
            pattern: calleeText,
            taintedArgument: taintedArg,
            file: filePath,
            line: node.startPosition.row + 1,
            column: node.startPosition.column,
            severity,
          };
        }
      }
    }
  }

  // Check assignments for property sinks (innerHTML, etc.)
  if (node.type === 'assignment_expression') {
    const left = node.childForFieldName('left');
    if (!left) return null;

    const leftText = left.text;
    const propertyName = getPropertyName(leftText);

    for (const { patterns, category, severity } of TAINT_SINKS) {
      for (const { pattern, property } of patterns) {
        if (property && propertyName === pattern) {
          const right = node.childForFieldName('right');
          const taintedArg = right?.text || '';

          return {
            category,
            pattern: leftText,
            taintedArgument: taintedArg,
            file: filePath,
            line: node.startPosition.row + 1,
            column: node.startPosition.column,
            severity,
          };
        }
      }
    }
  }

  return null;
}

/**
 * Find vulnerabilities by matching sources to sinks
 */
function findVulnerabilities(
  sources: TaintSource[],
  sinks: TaintSink[],
  rootNode: Parser.SyntaxNode
): DataflowAnalysisResult['vulnerabilities'] {
  const vulnerabilities: DataflowAnalysisResult['vulnerabilities'] = [];

  // Simple heuristic: check if sink arguments contain source variables
  for (const sink of sinks) {
    for (const source of sources) {
      // Check if the tainted variable appears in the sink's argument
      if (sink.taintedArgument.includes(source.taintedVariable)) {
        // Check if there's a sanitizer in between
        const hasSanitizer = checkForSanitizer(
          source.taintedVariable,
          sink.taintedArgument,
          rootNode
        );

        if (!hasSanitizer) {
          vulnerabilities.push({
            source,
            sink,
            category: sink.category,
            severity: sink.severity,
          });
        }
      }
    }
  }

  return vulnerabilities;
}

/**
 * Check if a sanitizer is applied between source and sink
 */
function checkForSanitizer(
  _sourceVar: string,
  sinkArg: string,
  _rootNode: Parser.SyntaxNode
): boolean {
  // Check if any sanitizer function is called on the variable
  for (const sanitizer of SANITIZERS) {
    if (sinkArg.includes(sanitizer)) {
      return true;
    }
  }
  return false;
}

/**
 * Build detailed flow paths (simplified implementation)
 */
function buildFlowPaths(
  sources: TaintSource[],
  sinks: TaintSink[],
  _rootNode: Parser.SyntaxNode,
  filePath: string,
  _maxDepth: number
): DataFlowPath[] {
  const paths: DataFlowPath[] = [];

  for (const source of sources) {
    const matchingSinks = sinks.filter(sink =>
      sink.taintedArgument.includes(source.taintedVariable)
    );

    for (const sink of matchingSinks) {
      const sanitizers = findSanitizersInPath(source.taintedVariable, sink.taintedArgument);

      paths.push({
        source,
        steps: [
          {
            name: source.taintedVariable,
            file: filePath,
            line: source.line,
            transformation: 'source',
            tainted: true,
            sanitized: false,
          },
          {
            name: sink.taintedArgument,
            file: filePath,
            line: sink.line,
            transformation: 'sink',
            tainted: sanitizers.length === 0,
            sanitized: sanitizers.length > 0,
          },
        ],
        sink,
        isVulnerable: sanitizers.length === 0,
        sanitizers,
      });
    }
  }

  return paths;
}

/**
 * Find sanitizers applied in a flow
 */
function findSanitizersInPath(_sourceVar: string, sinkArg: string): string[] {
  const found: string[] = [];
  for (const sanitizer of SANITIZERS) {
    if (sinkArg.includes(sanitizer)) {
      found.push(sanitizer);
    }
  }
  return found;
}

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Extract method name from call expression text
 */
function getMethodName(text: string): string {
  const parts = text.split('.');
  return parts[parts.length - 1] || text;
}

/**
 * Extract property name from member expression
 */
function getPropertyName(text: string): string {
  const parts = text.split('.');
  return parts[parts.length - 1] || text;
}

// ============================================================================
// Exported Utility Functions
// ============================================================================

/**
 * Check if a variable name is a known taint source
 */
export function isTaintSource(variableName: string): boolean {
  return TAINT_SOURCES.some(({ pattern }) => variableName.includes(pattern));
}

/**
 * Check if a function/method name is a known taint sink
 */
export function isTaintSink(name: string): boolean {
  return TAINT_SINKS.some(({ patterns }) =>
    patterns.some(({ pattern }) => name === pattern || name.endsWith('.' + pattern))
  );
}

/**
 * Check if a function name is a known sanitizer
 */
export function isSanitizer(name: string): boolean {
  return SANITIZERS.has(name) ||
    [...SANITIZERS].some(s => name.includes(s));
}

/**
 * Get all known taint source patterns
 */
export function getTaintSourcePatterns(): string[] {
  return TAINT_SOURCES.map(({ pattern }) => pattern);
}

/**
 * Get all known taint sink patterns
 */
export function getTaintSinkPatterns(): string[] {
  return TAINT_SINKS.flatMap(({ patterns }) =>
    patterns.map(({ pattern }) => pattern)
  );
}

/**
 * Get all known sanitizer patterns
 */
export function getSanitizerPatterns(): string[] {
  return [...SANITIZERS];
}

/**
 * Get summary of dataflow analysis
 */
export function getDataflowSummary(result: DataflowAnalysisResult): string {
  const parts: string[] = [];

  parts.push(`File: ${result.file}`);
  parts.push(`Taint sources: ${result.sources.length}`);
  parts.push(`Taint sinks: ${result.sinks.length}`);
  parts.push(`Potential vulnerabilities: ${result.vulnerabilities.length}`);

  if (result.vulnerabilities.length > 0) {
    parts.push('\nVulnerabilities:');
    for (const vuln of result.vulnerabilities) {
      parts.push(`  - ${vuln.category} (${vuln.severity}): ${vuln.source.pattern} → ${vuln.sink.pattern}`);
    }
  }

  return parts.join('\n');
}
