/**
 * Analysis module exports
 * Moved from @codegraph/parser in Phase 3B-2
 */

// Complexity (lives in @codegraph/plugin-typescript since Phase 3B-1)
export {
  calculateComplexity,
  calculateCyclomatic,
  calculateCognitive,
  calculateNestingDepth,
  classifyComplexity,
  COMPLEXITY_THRESHOLDS,
  type ComplexityMetrics,
} from '@codegraph/plugin-typescript';

// Security scanning
export {
  scanForVulnerabilities,
  scanFile,
  sortBySeverity,
  severityToNumber,
  type SecurityFinding,
  type SecuritySeverity,
  type ScanOptions,
} from './security';

// Payment security rules
export {
  scanForPaymentVulnerabilities,
  scanFileForPaymentIssues,
  getPaymentVulnerabilityTypes,
  type PaymentScanOptions,
} from './rules/payment';

// Impact analysis
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

// Refactoring analysis
export {
  analyzeRefactoring,
  classifyCouplingLevel,
  calculateCouplingScore,
  isSafeToExtract,
  getExtractionCandidatesQuery,
  getInternalCallsQuery,
  getExtractionOrder,
  getRefactoringSummary,
  needsRefactoring,
  DEFAULT_EXTRACTION_THRESHOLD,
  COUPLING_THRESHOLDS,
  type FunctionCoupling,
  type Responsibility,
  type RefactoringAnalysisResult,
  type RefactoringAnalysisInput,
  type RefactoringAnalysisOptions,
} from './refactoring';

// Dataflow / taint analysis
export {
  analyzeDataflow,
  isTaintSource,
  isTaintSink,
  isSanitizer,
  getTaintSourcePatterns,
  getTaintSinkPatterns,
  getSanitizerPatterns,
  getDataflowSummary,
  type TaintSource,
  type TaintSink,
  type TaintSourceCategory,
  type TaintSinkCategory,
  type FlowStep,
  type DataFlowPath,
  type DataflowAnalysisResult,
  type DataflowAnalysisOptions,
} from './dataflow';
