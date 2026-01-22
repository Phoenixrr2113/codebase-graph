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

export {
  analyzeImpact,
  classifyRisk,
  calculateRiskScore,
  getDirectCallersQuery,
  getTransitiveCallersQuery,
  getAffectedTestsQuery,
  isTestFile,
  getAffectedFiles,
  groupCallersByFile,
  getImpactSummary,
  RISK_WEIGHTS,
  RISK_THRESHOLDS,
  type ImpactAnalysisResult,
  type ImpactAnalysisInput,
  type ImpactAnalysisOptions,
  type CallerInfo,
  type TestInfo,
} from './impact';
