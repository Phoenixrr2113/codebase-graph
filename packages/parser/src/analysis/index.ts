/**
 * Analysis module exports
 */

export {
  calculateComplexity,
  calculateCyclomatic,
  calculateCognitive,
  calculateNestingDepth,
  classifyComplexity,
  COMPLEXITY_THRESHOLDS,
  type ComplexityMetrics,
} from './complexity';

export {
  scanForVulnerabilities,
  scanFile,
  sortBySeverity,
  severityToNumber,
  type SecurityFinding,
  type SecuritySeverity,
  type ScanOptions,
} from './security';

export {
  scanForPaymentVulnerabilities,
  scanFileForPaymentIssues,
  getPaymentVulnerabilityTypes,
  type PaymentScanOptions,
} from './rules/payment';
