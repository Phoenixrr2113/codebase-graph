import { codeGraphService } from '@codegraph/core';
import { createLogger } from '@codegraph/logger';
import { isAbsolute } from 'node:path';
import type { ToolDefinition } from '../tools/router';
import { validateFilePath } from './validation';

const logger = createLogger({ namespace: 'MCP:Persona:Analyze' });
const SYMBOL_ID_PATTERN = /^sym:v1:[a-f0-9]{64}$/;
const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2}))?$/;
const ACTIONS = [
  'impact',
  'import_cycles',
  'call_hierarchy',
  'dead_code',
  'hotspots',
  'change_coupling',
] as const;

type AnalyzeAction = typeof ACTIONS[number];
export const analyzePersonaDefinition: ToolDefinition = {
  name: 'analyze',
  description: `Analyze static code relationships and indexed git history with bounded, purpose-built queries.

**Actions:**
- **impact**: Find the static blast radius for a persisted symbol ID.
  Params: id (required), depth, limit
- **import_cycles**: Find canonical import cycles within one project root.
  Params: projectPath (required, absolute), maxDepth, limit
- **call_hierarchy**: Find direct callers, callees, or both for a persisted symbol ID.
  Params: id (required), direction, limit
- **dead_code**: Find unreferenced export candidates. Results are candidates, not proof of dead code.
  Params: projectPath (required, absolute), limit
- **hotspots**: Rank files by indexed change frequency with current complexity or import degree.
  Params: projectPath (required, absolute), since, scoreBy, limit
- **change_coupling**: Find file pairs that changed together within indexed history.
  Params: projectPath (required, absolute), since, minSupport, limit

Every response includes display-ready caveats and truncation metadata from the analysis layer. Git-backed actions also include historyCoverage. Static results do not prove runtime behavior, and git-backed results cover indexed history only.

**Examples:**
- Impact: { action: "impact", id: "sym:v1:0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef", depth: 3, limit: 100 }
- Import cycles: { action: "import_cycles", projectPath: "/workspace/project", maxDepth: 25, limit: 100 }
- Call hierarchy: { action: "call_hierarchy", id: "sym:v1:0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef", direction: "both", limit: 100 }
- Unreferenced exports: { action: "dead_code", projectPath: "/workspace/project", limit: 100 }
- Hotspots: { action: "hotspots", projectPath: "/workspace/project", since: "2026-01-01", scoreBy: "complexity", limit: 100 }
- Change coupling: { action: "change_coupling", projectPath: "/workspace/project", since: "2026-01-01", minSupport: 2, limit: 100 }`,
  inputSchema: {
    type: 'object',
    properties: {
      action: {
        type: 'string',
        enum: [...ACTIONS],
        description: 'Analysis action to run',
      },
      id: {
        type: 'string',
        description: 'Persisted sym:v1 symbol identifier for impact or call_hierarchy',
      },
      projectPath: {
        type: 'string',
        description: 'Absolute active project path for repository-wide actions',
      },
      depth: {
        type: 'number',
        description: 'Impact traversal depth from 1 through 10 (default: 3)',
      },
      maxDepth: {
        type: 'number',
        description: 'Import cycle traversal depth from 2 through 25 (default: 25)',
      },
      direction: {
        type: 'string',
        enum: ['callers', 'callees', 'both'],
        description: 'Call hierarchy direction (default: both)',
      },
      since: {
        type: 'string',
        description: 'Optional ISO 8601 date or timestamp for git-backed actions',
      },
      scoreBy: {
        type: 'string',
        enum: ['complexity', 'degree'],
        description: 'Hotspot score to rank by (default: complexity)',
      },
      minSupport: {
        type: 'number',
        description: 'Minimum co-change commit support from 1 through 200 (default: 2)',
      },
      limit: {
        type: 'number',
        description: 'Maximum results. Import cycles, hotspots, and change coupling allow 1 through 500 with default 50. Other actions allow 1 through 1000 with default 100.',
      },
    },
    required: ['action'],
  },
};

type ValidationResult<T> = { valid: true; value: T } | { valid: false; error: string };

function boundedInteger(
  raw: unknown,
  name: string,
  minimum: number,
  maximum: number,
  fallback: number,
): ValidationResult<number> {
  if (raw === undefined) return { valid: true, value: fallback };
  if (
    typeof raw !== 'number'
    || !Number.isSafeInteger(raw)
    || raw < minimum
    || raw > maximum
  ) {
    return {
      valid: false,
      error: `${name} must be an integer between ${minimum} and ${maximum}`,
    };
  }
  return { valid: true, value: raw };
}

function symbolId(raw: unknown, action: AnalyzeAction): ValidationResult<string> {
  if (typeof raw !== 'string' || raw.length === 0) {
    return { valid: false, error: `id is required for ${action} action` };
  }
  if (!SYMBOL_ID_PATTERN.test(raw)) {
    return { valid: false, error: 'id must be a persisted sym:v1 identifier' };
  }
  return { valid: true, value: raw };
}

function enumValue<T extends string>(
  raw: unknown,
  name: string,
  allowed: readonly T[],
  fallback: T,
): ValidationResult<T> {
  if (raw === undefined) return { valid: true, value: fallback };
  if (typeof raw !== 'string' || !allowed.includes(raw as T)) {
    return { valid: false, error: `${name} must be one of: ${allowed.join(', ')}` };
  }
  return { valid: true, value: raw as T };
}

function sinceValue(raw: unknown): ValidationResult<string | undefined> {
  if (raw === undefined) return { valid: true, value: undefined };
  if (typeof raw !== 'string') {
    return { valid: false, error: 'since must be a valid ISO 8601 date or timestamp' };
  }
  const timestamp = Date.parse(raw);
  if (!ISO_DATE_PATTERN.test(raw) || !Number.isFinite(timestamp)) {
    return { valid: false, error: 'since must be a valid ISO 8601 date or timestamp' };
  }
  if (!raw.includes('T') && new Date(timestamp).toISOString().slice(0, 10) !== raw) {
    return { valid: false, error: 'since must be a valid ISO 8601 date or timestamp' };
  }
  return { valid: true, value: raw };
}

async function projectRoot(raw: unknown, action: AnalyzeAction): Promise<ValidationResult<string>> {
  if (typeof raw !== 'string' || raw.length === 0) {
    return { valid: false, error: `projectPath is required for ${action} action` };
  }
  if (!isAbsolute(raw)) {
    return { valid: false, error: 'projectPath must be an absolute path' };
  }
  const checked = await validateFilePath(raw);
  if (!checked.valid) return checked;
  const normalized = checked.resolved === '/' ? '/' : checked.resolved.replace(/\/+$/, '');
  return { valid: true, value: normalized };
}

function withMeta(
  result: object,
  action: AnalyzeAction,
  toolUsed: string,
  startedAt: number,
): object {
  return {
    ...result,
    _meta: { action, toolUsed, durationMs: Date.now() - startedAt },
  };
}

export async function handleAnalyze(args: Record<string, unknown>): Promise<unknown> {
  const action = args.action;
  if (typeof action !== 'string' || !ACTIONS.includes(action as AnalyzeAction)) {
    return {
      error: `Unknown analyze action: ${String(action)}. Use: ${ACTIONS.join(', ')}`,
    };
  }

  const typedAction = action as AnalyzeAction;
  const startedAt = Date.now();
  let result: object;
  let toolUsed: string;

  switch (typedAction) {
    case 'impact': {
      const limit = boundedInteger(args.limit, 'limit', 1, 1000, 100);
      if (!limit.valid) return { error: limit.error };
      const id = symbolId(args.id, typedAction);
      if (!id.valid) return { error: id.error };
      const depth = boundedInteger(args.depth, 'depth', 1, 10, 3);
      if (!depth.valid) return { error: depth.error };
      result = await codeGraphService.getBlastRadius({
        id: id.value,
        depth: depth.value,
        limit: limit.value,
      });
      toolUsed = 'getBlastRadius';
      break;
    }

    case 'import_cycles': {
      const limit = boundedInteger(args.limit, 'limit', 1, 500, 50);
      if (!limit.valid) return { error: limit.error };
      const rootPath = await projectRoot(args.projectPath, typedAction);
      if (!rootPath.valid) return { error: rootPath.error };
      const maxDepth = boundedInteger(args.maxDepth, 'maxDepth', 2, 25, 25);
      if (!maxDepth.valid) return { error: maxDepth.error };
      result = await codeGraphService.getImportCycles({
        rootPath: rootPath.value,
        maxDepth: maxDepth.value,
        limit: limit.value,
      });
      toolUsed = 'getImportCycles';
      break;
    }

    case 'call_hierarchy': {
      const limit = boundedInteger(args.limit, 'limit', 1, 1000, 100);
      if (!limit.valid) return { error: limit.error };
      const id = symbolId(args.id, typedAction);
      if (!id.valid) return { error: id.error };
      const direction = enumValue(
        args.direction,
        'direction',
        ['callers', 'callees', 'both'] as const,
        'both',
      );
      if (!direction.valid) return { error: direction.error };
      result = await codeGraphService.getCallHierarchy({
        id: id.value,
        direction: direction.value,
        limit: limit.value,
      });
      toolUsed = 'getCallHierarchy';
      break;
    }

    case 'dead_code': {
      const limit = boundedInteger(args.limit, 'limit', 1, 1000, 100);
      if (!limit.valid) return { error: limit.error };
      const rootPath = await projectRoot(args.projectPath, typedAction);
      if (!rootPath.valid) return { error: rootPath.error };
      result = await codeGraphService.getUnreferencedExports({
        rootPath: rootPath.value,
        limit: limit.value,
      });
      toolUsed = 'getUnreferencedExports';
      break;
    }

    case 'hotspots': {
      const limit = boundedInteger(args.limit, 'limit', 1, 500, 50);
      if (!limit.valid) return { error: limit.error };
      const rootPath = await projectRoot(args.projectPath, typedAction);
      if (!rootPath.valid) return { error: rootPath.error };
      const since = sinceValue(args.since);
      if (!since.valid) return { error: since.error };
      const scoreBy = enumValue(
        args.scoreBy,
        'scoreBy',
        ['complexity', 'degree'] as const,
        'complexity',
      );
      if (!scoreBy.valid) return { error: scoreBy.error };
      result = await codeGraphService.getHotspots({
        rootPath: rootPath.value,
        ...(since.value === undefined ? {} : { since: since.value }),
        scoreBy: scoreBy.value,
        limit: limit.value,
      });
      toolUsed = 'getHotspots';
      break;
    }

    case 'change_coupling': {
      const limit = boundedInteger(args.limit, 'limit', 1, 500, 50);
      if (!limit.valid) return { error: limit.error };
      const rootPath = await projectRoot(args.projectPath, typedAction);
      if (!rootPath.valid) return { error: rootPath.error };
      const since = sinceValue(args.since);
      if (!since.valid) return { error: since.error };
      const minSupport = boundedInteger(args.minSupport, 'minSupport', 1, 200, 2);
      if (!minSupport.valid) return { error: minSupport.error };
      result = await codeGraphService.getChangeCoupling({
        rootPath: rootPath.value,
        ...(since.value === undefined ? {} : { since: since.value }),
        minSupport: minSupport.value,
        limit: limit.value,
      });
      toolUsed = 'getChangeCoupling';
      break;
    }
  }

  logger.debug('Analyze persona completed', {
    action: typedAction,
    toolUsed,
    durationMs: Date.now() - startedAt,
  });
  return withMeta(result, typedAction, toolUsed, startedAt);
}
