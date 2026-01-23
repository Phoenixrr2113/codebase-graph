/**
 * Payment Security Rules
 * Detects payment processing vulnerabilities for Stripe, Adyen, etc.
 * Based on CodeGraph v2 Specification
 */

import Parser from 'tree-sitter';
import { SecurityFinding, SecuritySeverity } from '../security';

// ============================================================================
// Payment-Specific Security Patterns
// ============================================================================

/**
 * Stripe payment method patterns
 */
const STRIPE_PAYMENT_METHODS = new Set([
  'charges.create',
  'paymentIntents.create',
  'paymentIntents.confirm',
  'checkout.sessions.create',
  'invoices.create',
  'subscriptions.create',
]);

/**
 * Adyen payment patterns
 */
const ADYEN_PAYMENT_METHODS = new Set([
  'payments',
  'payments/details',
  'authorise',
]);

/**
 * User input sources for amounts
 */
const AMOUNT_SOURCES = [
  'req.body.amount',
  'request.body.amount',
  'body.amount',
  'params.amount',
  'query.amount',
  'data.amount',
];

/**
 * PCI-sensitive data field names
 */
const PCI_SENSITIVE_FIELDS = new Set([
  'cardNumber',
  'card_number',
  'cardnumber',
  'cvv',
  'cvc',
  'cvv2',
  'cvc2',
  'securityCode',
  'security_code',
  'pan',
  'primaryAccountNumber',
  'primary_account_number',
  'expiry',
  'expiryDate',
  'expiry_date',
  'expirationDate',
  'expiration_date',
  'cardholderName',
  'cardholder_name',
]);

/**
 * Logging functions that could expose PCI data
 */
const LOGGING_FUNCTIONS = new Set([
  'console.log',
  'console.info',
  'console.debug',
  'console.warn',
  'console.error',
  'logger.log',
  'logger.info',
  'logger.debug',
  'logger.warn',
  'logger.error',
  'log.info',
  'log.debug',
  'log.error',
  'winston.info',
  'winston.debug',
  'winston.error',
]);

/**
 * Stripe key patterns (hardcoded)
 */
const STRIPE_KEY_PATTERNS = [
  /['"]sk_live_[a-zA-Z0-9]{24,}['"]/,
  /['"]sk_test_[a-zA-Z0-9]{24,}['"]/,
  /['"]pk_live_[a-zA-Z0-9]{24,}['"]/,
  /['"]pk_test_[a-zA-Z0-9]{24,}['"]/,
  /['"]rk_live_[a-zA-Z0-9]{24,}['"]/,
  /['"]rk_test_[a-zA-Z0-9]{24,}['"]/,
  /['"]whsec_[a-zA-Z0-9]{24,}['"]/,
];

/**
 * Adyen key patterns
 */
const ADYEN_KEY_PATTERNS = [
  /['"]AQE[a-zA-Z0-9_-]{40,}['"]/,
  /['"][A-Z0-9]{8}-[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{12}['"]/,
];

// ============================================================================
// Payment Security Scanner
// ============================================================================

/**
 * Options for payment security scanning
 */
export interface PaymentScanOptions {
  filePath: string;
}

/**
 * Scan for payment-specific security vulnerabilities
 */
export function scanForPaymentVulnerabilities(
  rootNode: Parser.SyntaxNode,
  options: PaymentScanOptions
): SecurityFinding[] {
  const findings: SecurityFinding[] = [];
  const { filePath } = options;

  walkNode(rootNode, (node) => {
    // Check for unvalidated payment amounts
    const amountFindings = checkUnvalidatedAmount(node, filePath);
    findings.push(...amountFindings);

    // Check for PCI data logging
    const pciFindings = checkPciDataLogging(node, filePath);
    findings.push(...pciFindings);

    // Check for hardcoded payment keys
    const keyFindings = checkHardcodedPaymentKeys(node, filePath);
    findings.push(...keyFindings);

    // Check for missing idempotency keys
    const idempotencyFindings = checkMissingIdempotencyKey(node, filePath);
    findings.push(...idempotencyFindings);
  });

  return findings;
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

// ============================================================================
// Individual Payment Vulnerability Checkers
// ============================================================================

/**
 * Check for unvalidated payment amounts being passed directly from user input
 */
function checkUnvalidatedAmount(
  node: Parser.SyntaxNode,
  filePath: string
): SecurityFinding[] {
  const findings: SecurityFinding[] = [];

  if (node.type === 'call_expression') {
    const callee = node.childForFieldName('function');
    if (!callee) return findings;

    const calleeText = callee.text;
    
    // Check if this is a payment method call
    const isStripePayment = [...STRIPE_PAYMENT_METHODS].some(method => 
      calleeText.includes(method)
    );
    const isAdyenPayment = [...ADYEN_PAYMENT_METHODS].some(method => 
      calleeText.includes(method)
    );

    if (isStripePayment || isAdyenPayment) {
      const args = node.childForFieldName('arguments');
      if (args) {
        // Check if any argument contains direct user input for amount
        const argsText = args.text;
        for (const source of AMOUNT_SOURCES) {
          if (argsText.includes(source)) {
            findings.push({
              type: 'unvalidated_payment_amount',
              severity: 'critical' as SecuritySeverity,
              file: filePath,
              line: node.startPosition.row + 1,
              column: node.startPosition.column,
              code: node.text.slice(0, 150),
              description: 'Payment amount passed directly from user input without validation',
              fix: 'Validate payment amounts server-side before passing to payment processor. Check against expected values or order totals.',
            });
            break;
          }
        }
      }
    }
  }

  return findings;
}

/**
 * Check for PCI-sensitive data being logged
 */
function checkPciDataLogging(
  node: Parser.SyntaxNode,
  filePath: string
): SecurityFinding[] {
  const findings: SecurityFinding[] = [];

  if (node.type === 'call_expression') {
    const callee = node.childForFieldName('function');
    if (!callee) return findings;

    const calleeText = callee.text;
    
    // Check if this is a logging call
    if (LOGGING_FUNCTIONS.has(calleeText)) {
      const args = node.childForFieldName('arguments');
      if (args) {
        const argsText = args.text.toLowerCase();
        
        // Check for PCI-sensitive field names in logged data
        for (const field of PCI_SENSITIVE_FIELDS) {
          if (argsText.includes(field.toLowerCase())) {
            findings.push({
              type: 'pci_data_logging',
              severity: 'critical' as SecuritySeverity,
              file: filePath,
              line: node.startPosition.row + 1,
              column: node.startPosition.column,
              code: node.text.slice(0, 100),
              description: `PCI-sensitive data (${field}) may be logged - PCI DSS violation`,
              fix: 'Never log card numbers, CVVs, or other PCI-sensitive data. Mask or omit sensitive fields before logging.',
            });
            break;
          }
        }
      }
    }
  }

  return findings;
}

/**
 * Check for hardcoded payment processor keys
 */
function checkHardcodedPaymentKeys(
  node: Parser.SyntaxNode,
  filePath: string
): SecurityFinding[] {
  const findings: SecurityFinding[] = [];

  // Check string literals
  if (
    node.type === 'string' ||
    node.type === 'template_string' ||
    node.type === 'template_literal'
  ) {
    const text = node.text;

    // Check Stripe keys
    for (const pattern of STRIPE_KEY_PATTERNS) {
      if (pattern.test(text)) {
        // Determine key type for more specific messaging
        let keyType = 'Stripe';
        if (text.includes('sk_live')) keyType = 'Stripe Live Secret';
        else if (text.includes('sk_test')) keyType = 'Stripe Test Secret';
        else if (text.includes('pk_live')) keyType = 'Stripe Live Publishable';
        else if (text.includes('pk_test')) keyType = 'Stripe Test Publishable';
        else if (text.includes('rk_')) keyType = 'Stripe Restricted';
        else if (text.includes('whsec_')) keyType = 'Stripe Webhook Secret';

        findings.push({
          type: 'hardcoded_payment_key',
          severity: 'critical' as SecuritySeverity,
          file: filePath,
          line: node.startPosition.row + 1,
          column: node.startPosition.column,
          code: text.slice(0, 30) + '...',
          description: `Hardcoded ${keyType} key detected`,
          fix: 'Store payment keys in environment variables (e.g., STRIPE_SECRET_KEY). Never commit keys to source control.',
        });
        return findings; // Only report once per node
      }
    }

    // Check Adyen keys
    for (const pattern of ADYEN_KEY_PATTERNS) {
      if (pattern.test(text)) {
        findings.push({
          type: 'hardcoded_payment_key',
          severity: 'critical' as SecuritySeverity,
          file: filePath,
          line: node.startPosition.row + 1,
          column: node.startPosition.column,
          code: text.slice(0, 30) + '...',
          description: 'Hardcoded Adyen API key detected',
          fix: 'Store payment keys in environment variables. Never commit keys to source control.',
        });
        return findings;
      }
    }
  }

  // Also check variable declarations for payment key patterns
  if (node.type === 'variable_declarator') {
    const nodeText = node.text;
    const allPatterns = [...STRIPE_KEY_PATTERNS, ...ADYEN_KEY_PATTERNS];
    for (const pattern of allPatterns) {
      if (pattern.test(nodeText)) {
        findings.push({
          type: 'hardcoded_payment_key',
          severity: 'critical' as SecuritySeverity,
          file: filePath,
          line: node.startPosition.row + 1,
          column: node.startPosition.column,
          code: nodeText.slice(0, 50) + '...',
          description: 'Hardcoded payment API key assigned to variable',
          fix: 'Store payment keys in environment variables. Never commit keys to source control.',
        });
        break;
      }
    }
  }

  return findings;
}

/**
 * Check for Stripe payment calls missing idempotency keys
 */
function checkMissingIdempotencyKey(
  node: Parser.SyntaxNode,
  filePath: string
): SecurityFinding[] {
  const findings: SecurityFinding[] = [];

  if (node.type === 'call_expression') {
    const callee = node.childForFieldName('function');
    if (!callee) return findings;

    const calleeText = callee.text;
    
    // Check for payment methods that should have idempotency keys
    const needsIdempotency = [
      'charges.create',
      'paymentIntents.create',
      'paymentIntents.confirm',
      'refunds.create',
      'transfers.create',
      'payouts.create',
      'subscriptions.create',
    ];

    const isPaymentMethod = needsIdempotency.some(method => 
      calleeText.includes(method)
    );

    if (isPaymentMethod) {
      const args = node.childForFieldName('arguments');
      if (args) {
        const argsText = args.text;
        // Check if idempotencyKey is present
        if (!argsText.includes('idempotencyKey') && !argsText.includes('idempotency_key')) {
          findings.push({
            type: 'missing_idempotency_key',
            severity: 'high' as SecuritySeverity,
            file: filePath,
            line: node.startPosition.row + 1,
            column: node.startPosition.column,
            code: node.text.slice(0, 100),
            description: 'Payment operation missing idempotency key - risks duplicate charges on retry',
            fix: 'Add idempotencyKey option to payment operations: { idempotencyKey: uniqueId }',
          });
        }
      }
    }
  }

  return findings;
}

// ============================================================================
// Aggregate Functions
// ============================================================================

/**
 * Scan a file for all payment security vulnerabilities
 */
export function scanFileForPaymentIssues(
  rootNode: Parser.SyntaxNode,
  filePath: string
): {
  findings: SecurityFinding[];
  summary: {
    unvalidatedAmounts: number;
    pciLogging: number;
    hardcodedKeys: number;
    missingIdempotency: number;
    total: number;
  };
} {
  const findings = scanForPaymentVulnerabilities(rootNode, { filePath });
  
  const summary = {
    unvalidatedAmounts: findings.filter(f => f.type === 'unvalidated_payment_amount').length,
    pciLogging: findings.filter(f => f.type === 'pci_data_logging').length,
    hardcodedKeys: findings.filter(f => f.type === 'hardcoded_payment_key').length,
    missingIdempotency: findings.filter(f => f.type === 'missing_idempotency_key').length,
    total: findings.length,
  };

  return { findings, summary };
}

/**
 * Get all payment-related vulnerability types
 */
export function getPaymentVulnerabilityTypes(): string[] {
  return [
    'unvalidated_payment_amount',
    'pci_data_logging',
    'hardcoded_payment_key',
    'missing_idempotency_key',
  ];
}
