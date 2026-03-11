/**
 * Rule Loader — Loads externalized security and payment rules from JSON files
 *
 * Compiles string patterns into Sets and RegExp objects for runtime use.
 * Rules are loaded once and cached for the process lifetime.
 *
 * This module centralizes all vulnerability detection patterns, eliminating
 * duplication between security.ts and dataflow.ts (WS4).
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

// ============================================================================
// Compiled Rule Types
// ============================================================================

/** Compiled security rules ready for runtime use */
export interface SecurityRules {
  /** Taint sources categorized by origin */
  taintSources: {
    userInput: Set<string>;
    environment: Set<string>;
    fileRead: Set<string>;
    apiResponse: Set<string>;
    /** All sources as a flat set (for backward compat with security.ts) */
    all: Set<string>;
    /** Categorized sources (for dataflow.ts) */
    categorized: Array<{ pattern: string; category: string }>;
  };

  /** SQL injection detection patterns */
  sqlInjection: {
    severity: string;
    description: string;
    fix: string;
    methods: Set<string>;
    dangerousPatterns: RegExp[];
  };

  /** XSS detection patterns */
  xss: {
    severity: string;
    description: string;
    fix: string;
    properties: Set<string>;
    methods: Set<string>;
    jsxProperties: Set<string>;
  };

  /** Command injection detection patterns */
  commandInjection: {
    severity: string;
    description: string;
    fix: string;
    methods: Set<string>;
    modules: Set<string>;
  };

  /** Path traversal detection patterns */
  pathTraversal: {
    severity: string;
    description: string;
    fix: string;
    methods: Set<string>;
  };

  /** Hardcoded secrets detection patterns */
  hardcodedSecrets: {
    severity: string;
    description: string;
    fix: string;
    patterns: RegExp[];
  };

  /** Eval/dynamic code execution patterns */
  evalUsage: {
    severity: string;
    description: string;
    fix: string;
    functions: Set<string>;
  };

  /** Known sanitizer functions */
  sanitizers: Set<string>;

  /** Taint sinks (for dataflow analysis) */
  taintSinks: Array<{
    patterns: Array<{ pattern: string; method?: boolean; property?: boolean }>;
    category: string;
    severity: string;
  }>;
}

/** Compiled payment rules ready for runtime use */
export interface PaymentRules {
  stripe: {
    paymentMethods: Set<string>;
    keyPatterns: RegExp[];
    idempotencyRequiredMethods: string[];
  };

  adyen: {
    paymentMethods: Set<string>;
    keyPatterns: RegExp[];
  };

  amountSources: string[];
  pciSensitiveFields: Set<string>;
  loggingFunctions: Set<string>;

  vulnerabilities: Record<string, {
    severity: string;
    type: string;
    description: string;
    fix: string;
  }>;
}

// ============================================================================
// Rule Loading
// ============================================================================

let _securityRules: SecurityRules | null = null;
let _paymentRules: PaymentRules | null = null;

/**
 * Load and compile security rules from JSON.
 * Results are cached for the process lifetime.
 */
export function getSecurityRules(): SecurityRules {
  if (_securityRules) return _securityRules;

  const rulesPath = join(__dirname, 'security-rules.json');
  const raw = JSON.parse(readFileSync(rulesPath, 'utf-8'));

  // Build categorized taint sources
  const userInput = new Set<string>(raw.taint_sources.user_input);
  const environment = new Set<string>(raw.taint_sources.environment);
  const fileRead = new Set<string>(raw.taint_sources.file_read);
  const apiResponse = new Set<string>(raw.taint_sources.api_response);

  // Flatten all sources into a single set
  const allSources = new Set<string>([
    ...userInput,
    ...environment,
    ...fileRead,
    ...apiResponse,
  ]);

  // Build categorized array for dataflow.ts
  const categorized: Array<{ pattern: string; category: string }> = [
    ...raw.taint_sources.user_input.map((p: string) => ({ pattern: p, category: 'user_input' })),
    ...raw.taint_sources.api_response.map((p: string) => ({ pattern: p, category: 'api_response' })),
    ...raw.taint_sources.file_read.map((p: string) => ({ pattern: p, category: 'file_read' })),
    ...raw.taint_sources.environment.map((p: string) => ({ pattern: p, category: 'environment' })),
  ];

  // Compile regex patterns
  const secretPatterns = (raw.hardcoded_secrets.patterns as string[]).map(
    (p: string, i: number) => new RegExp(p, raw.hardcoded_secrets.pattern_flags?.[i] ?? ''),
  );

  const dangerousPatterns = (raw.sql_injection.dangerous_patterns as string[]).map(
    (p: string) => new RegExp(p),
  );

  // Build taint sinks for dataflow analysis
  const taintSinks = [
    {
      patterns: raw.sql_injection.methods.map((m: string) => ({ pattern: m, method: true })),
      category: 'sql_injection',
      severity: raw.sql_injection.severity,
    },
    {
      patterns: raw.command_injection.methods.map((m: string) => ({ pattern: m, method: true })),
      category: 'command_injection',
      severity: raw.command_injection.severity,
    },
    {
      patterns: [
        ...raw.xss.properties.map((p: string) => ({ pattern: p, property: true })),
        ...raw.xss.methods.map((m: string) => ({ pattern: m, method: true })),
        ...raw.xss.jsx_properties.map((p: string) => ({ pattern: p, property: true })),
      ],
      category: 'xss',
      severity: raw.xss.severity,
    },
    {
      patterns: raw.path_traversal.methods.map((m: string) => ({ pattern: m, method: true })),
      category: 'path_traversal',
      severity: raw.path_traversal.severity,
    },
  ];

  _securityRules = {
    taintSources: {
      userInput,
      environment,
      fileRead,
      apiResponse,
      all: allSources,
      categorized,
    },
    sqlInjection: {
      severity: raw.sql_injection.severity,
      description: raw.sql_injection.description,
      fix: raw.sql_injection.fix,
      methods: new Set(raw.sql_injection.methods),
      dangerousPatterns,
    },
    xss: {
      severity: raw.xss.severity,
      description: raw.xss.description,
      fix: raw.xss.fix,
      properties: new Set(raw.xss.properties),
      methods: new Set(raw.xss.methods),
      jsxProperties: new Set(raw.xss.jsx_properties),
    },
    commandInjection: {
      severity: raw.command_injection.severity,
      description: raw.command_injection.description,
      fix: raw.command_injection.fix,
      methods: new Set(raw.command_injection.methods),
      modules: new Set(raw.command_injection.modules),
    },
    pathTraversal: {
      severity: raw.path_traversal.severity,
      description: raw.path_traversal.description,
      fix: raw.path_traversal.fix,
      methods: new Set(raw.path_traversal.methods),
    },
    hardcodedSecrets: {
      severity: raw.hardcoded_secrets.severity,
      description: raw.hardcoded_secrets.description,
      fix: raw.hardcoded_secrets.fix,
      patterns: secretPatterns,
    },
    evalUsage: {
      severity: raw.eval_usage.severity,
      description: raw.eval_usage.description,
      fix: raw.eval_usage.fix,
      functions: new Set(raw.eval_usage.functions),
    },
    sanitizers: new Set(raw.sanitizers),
    taintSinks,
  };

  return _securityRules;
}

/**
 * Load and compile payment rules from JSON.
 * Results are cached for the process lifetime.
 */
export function getPaymentRules(): PaymentRules {
  if (_paymentRules) return _paymentRules;

  const rulesPath = join(__dirname, 'payment-rules.json');
  const raw = JSON.parse(readFileSync(rulesPath, 'utf-8'));

  _paymentRules = {
    stripe: {
      paymentMethods: new Set(raw.stripe.payment_methods),
      keyPatterns: raw.stripe.key_patterns.map((p: string) => new RegExp(p)),
      idempotencyRequiredMethods: raw.stripe.idempotency_required_methods,
    },
    adyen: {
      paymentMethods: new Set(raw.adyen.payment_methods),
      keyPatterns: raw.adyen.key_patterns.map((p: string) => new RegExp(p)),
    },
    amountSources: raw.amount_sources,
    pciSensitiveFields: new Set(raw.pci_sensitive_fields),
    loggingFunctions: new Set(raw.logging_functions),
    vulnerabilities: raw.vulnerabilities,
  };

  return _paymentRules;
}

/**
 * Reset cached rules (for testing).
 */
export function resetRuleCache(): void {
  _securityRules = null;
  _paymentRules = null;
}

/**
 * Get all vulnerability type metadata from both security and payment rules.
 */
export function getVulnerabilityTypes(): Array<{
  type: string;
  severity: string;
  description: string;
}> {
  const security = getSecurityRules();
  const payment = getPaymentRules();

  return [
    { type: 'sql_injection', severity: security.sqlInjection.severity, description: security.sqlInjection.description },
    { type: 'xss', severity: security.xss.severity, description: security.xss.description },
    { type: 'command_injection', severity: security.commandInjection.severity, description: security.commandInjection.description },
    { type: 'path_traversal', severity: security.pathTraversal.severity, description: security.pathTraversal.description },
    { type: 'hardcoded_secret', severity: security.hardcodedSecrets.severity, description: security.hardcodedSecrets.description },
    { type: 'eval_usage', severity: security.evalUsage.severity, description: security.evalUsage.description },
    ...Object.entries(payment.vulnerabilities).map(([, v]) => ({
      type: v.type,
      severity: v.severity,
      description: v.description,
    })),
  ];
}
