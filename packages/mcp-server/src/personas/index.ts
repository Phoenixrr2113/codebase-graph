/**
 * Persona Registry
 *
 * Consolidates 29 raw MCP tools into 5 high-level persona tools.
 * Controlled by CODEGRAPH_RAW_TOOLS env var:
 *   - unset/false: Only persona tools exposed (default)
 *   - true: Raw tools exposed alongside personas
 */

import type { ToolDefinition } from '../tools/consolidated';
import { searchPersonaDefinition, handleSearch } from './search';
import { analyzePersonaDefinition, handleAnalyze } from './analyze';
import { knowledgePersonaDefinition, handleKnowledge } from './knowledge';
import { indexPersonaDefinition, handleIndex } from './codebase';
import { queryPersonaDefinition, handleQuery } from './query';

// ============================================================================
// Persona Tool Definitions
// ============================================================================

export const personaToolDefinitions: ToolDefinition[] = [
  searchPersonaDefinition,
  analyzePersonaDefinition,
  knowledgePersonaDefinition,
  indexPersonaDefinition,
  queryPersonaDefinition,
];

// ============================================================================
// Persona Handlers
// ============================================================================

export const personaHandlers: Record<string, (args: Record<string, unknown>) => Promise<unknown>> = {
  search: handleSearch,
  analyze: handleAnalyze,
  knowledge: handleKnowledge,
  codebase: handleIndex,
  query: handleQuery,
};

// ============================================================================
// Mode Detection
// ============================================================================

export function useRawTools(): boolean {
  return process.env.CODEGRAPH_RAW_TOOLS === 'true';
}

// Re-export for convenience
export { searchPersonaDefinition, handleSearch } from './search';
export { analyzePersonaDefinition, handleAnalyze } from './analyze';
export { knowledgePersonaDefinition, handleKnowledge } from './knowledge';
export { indexPersonaDefinition, handleIndex } from './codebase';
export { queryPersonaDefinition, handleQuery } from './query';
