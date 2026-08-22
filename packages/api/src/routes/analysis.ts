import { AnalysisQueryInputError, codeGraphService } from '@codegraph/core';
import { Hono } from 'hono';
import { safeErrorMessage } from '../safe-error';

const SYMBOL_ID_PATTERN = /^sym:v1:[a-f0-9]{64}$/;
const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2}))?$/;
const RESULT_LIMIT_MAX = 1000;

function isNotFoundResult(result: object): boolean {
  return 'status' in result && result.status === 'not_found';
}

type IntegerResult =
  | { valid: true; value?: number }
  | { valid: false; error: string };

function boundedInteger(
  raw: string | undefined,
  name: string,
  min: number,
  max: number,
): IntegerResult {
  if (raw === undefined) return { valid: true };
  const value = Number(raw);
  if (!/^\d+$/.test(raw) || !Number.isSafeInteger(value) || value < min || value > max) {
    return { valid: false, error: `${name} must be an integer between ${min} and ${max}` };
  }
  return { valid: true, value };
}

function parseSymbolId(raw: string | undefined): { valid: true; value: string } | { valid: false; error: string } {
  if (!raw) return { valid: false, error: 'id parameter is required' };
  if (!SYMBOL_ID_PATTERN.test(raw)) {
    return { valid: false, error: 'id must be a persisted sym:v1 identifier' };
  }
  return { valid: true, value: raw };
}

function parseEnum<T extends string>(
  raw: string | undefined,
  name: string,
  values: readonly T[],
): { valid: true; value?: T } | { valid: false; error: string } {
  if (raw === undefined) return { valid: true };
  if (!values.includes(raw as T)) {
    return { valid: false, error: `${name} must be one of: ${values.join(', ')}` };
  }
  return { valid: true, value: raw as T };
}

function parseSince(raw: string | undefined): { valid: true; value?: string } | { valid: false; error: string } {
  if (raw === undefined) return { valid: true };
  const timestamp = Date.parse(raw);
  if (!ISO_DATE_PATTERN.test(raw) || !Number.isFinite(timestamp)) {
    return { valid: false, error: 'since must be a valid ISO 8601 date or timestamp' };
  }
  const dateOnlyIsExact = raw.includes('T') || new Date(timestamp).toISOString().slice(0, 10) === raw;
  if (!dateOnlyIsExact) {
    return { valid: false, error: 'since must be a valid ISO 8601 date or timestamp' };
  }
  return { valid: true, value: raw };
}

function normalizeRootPath(rootPath: string): string {
  return rootPath === '/' ? rootPath : rootPath.replace(/\/+$/, '');
}

export const analysisRoutes = new Hono();

analysisRoutes.get('/api/analysis/blast-radius', async (c) => {
  try {
    const id = parseSymbolId(c.req.query('id'));
    if (!id.valid) return c.json({ error: id.error }, 400);
    const depth = boundedInteger(c.req.query('depth'), 'depth', 1, 10);
    if (!depth.valid) return c.json({ error: depth.error }, 400);
    const limit = boundedInteger(c.req.query('limit'), 'limit', 1, RESULT_LIMIT_MAX);
    if (!limit.valid) return c.json({ error: limit.error }, 400);

    const result = await codeGraphService.getBlastRadius({
      id: id.value,
      ...(depth.value === undefined ? {} : { depth: depth.value }),
      ...(limit.value === undefined ? {} : { limit: limit.value }),
    });
    return c.json(result, isNotFoundResult(result) ? 404 : 200);
  } catch (error) {
    if (error instanceof AnalysisQueryInputError) return c.json({ error: error.message }, 400);
    return c.json({
      error: safeErrorMessage(
        'GET /api/analysis/blast-radius',
        error,
        'Failed to analyze blast radius.',
      ),
    }, 500);
  }
});

analysisRoutes.get('/api/analysis/call-hierarchy', async (c) => {
  try {
    const id = parseSymbolId(c.req.query('id'));
    if (!id.valid) return c.json({ error: id.error }, 400);
    const direction = parseEnum(
      c.req.query('direction'),
      'direction',
      ['callers', 'callees', 'both'] as const,
    );
    if (!direction.valid) return c.json({ error: direction.error }, 400);
    const limit = boundedInteger(c.req.query('limit'), 'limit', 1, RESULT_LIMIT_MAX);
    if (!limit.valid) return c.json({ error: limit.error }, 400);

    const result = await codeGraphService.getCallHierarchy({
      id: id.value,
      ...(direction.value === undefined ? {} : { direction: direction.value }),
      ...(limit.value === undefined ? {} : { limit: limit.value }),
    });
    return c.json(result, isNotFoundResult(result) ? 404 : 200);
  } catch (error) {
    if (error instanceof AnalysisQueryInputError) return c.json({ error: error.message }, 400);
    return c.json({
      error: safeErrorMessage(
        'GET /api/analysis/call-hierarchy',
        error,
        'Failed to analyze call hierarchy.',
      ),
    }, 500);
  }
});

interface ProjectRequest {
  rootPath: string;
  limit?: number;
}

async function resolveProjectRequest(
  projectId: string | undefined,
  rawLimit: string | undefined,
  maximumLimit: number,
): Promise<
  | { valid: true; value: ProjectRequest }
  | { valid: false; status: 400 | 404; error: string }
> {
  if (!projectId) {
    return { valid: false, status: 400, error: 'projectId parameter is required' };
  }
  const limit = boundedInteger(rawLimit, 'limit', 1, maximumLimit);
  if (!limit.valid) return { valid: false, status: 400, error: limit.error };

  const rootPath = await codeGraphService.resolveProjectRootPath(projectId);
  if (!rootPath) return { valid: false, status: 404, error: 'Project not found' };
  return {
    valid: true,
    value: {
      rootPath: normalizeRootPath(rootPath),
      ...(limit.value === undefined ? {} : { limit: limit.value }),
    },
  };
}

analysisRoutes.get('/api/analysis/import-cycles', async (c) => {
  try {
    const maxDepth = boundedInteger(c.req.query('maxDepth'), 'maxDepth', 2, 25);
    if (!maxDepth.valid) return c.json({ error: maxDepth.error }, 400);
    const project = await resolveProjectRequest(c.req.query('projectId'), c.req.query('limit'), 500);
    if (!project.valid) return c.json({ error: project.error }, project.status);

    return c.json(await codeGraphService.getImportCycles({
      ...project.value,
      ...(maxDepth.value === undefined ? {} : { maxDepth: maxDepth.value }),
    }));
  } catch (error) {
    if (error instanceof AnalysisQueryInputError) return c.json({ error: error.message }, 400);
    return c.json({
      error: safeErrorMessage(
        'GET /api/analysis/import-cycles',
        error,
        'Failed to analyze import cycles.',
      ),
    }, 500);
  }
});

analysisRoutes.get('/api/analysis/dead-code', async (c) => {
  try {
    const project = await resolveProjectRequest(
      c.req.query('projectId'),
      c.req.query('limit'),
      RESULT_LIMIT_MAX,
    );
    if (!project.valid) return c.json({ error: project.error }, project.status);
    return c.json(await codeGraphService.getUnreferencedExports(project.value));
  } catch (error) {
    if (error instanceof AnalysisQueryInputError) return c.json({ error: error.message }, 400);
    return c.json({
      error: safeErrorMessage(
        'GET /api/analysis/dead-code',
        error,
        'Failed to analyze unreferenced exports.',
      ),
    }, 500);
  }
});

analysisRoutes.get('/api/analysis/hotspots', async (c) => {
  try {
    const since = parseSince(c.req.query('since'));
    if (!since.valid) return c.json({ error: since.error }, 400);
    const scoreBy = parseEnum(
      c.req.query('scoreBy'),
      'scoreBy',
      ['complexity', 'degree'] as const,
    );
    if (!scoreBy.valid) return c.json({ error: scoreBy.error }, 400);
    const project = await resolveProjectRequest(c.req.query('projectId'), c.req.query('limit'), 500);
    if (!project.valid) return c.json({ error: project.error }, project.status);

    return c.json(await codeGraphService.getHotspots({
      ...project.value,
      ...(since.value === undefined ? {} : { since: since.value }),
      ...(scoreBy.value === undefined ? {} : { scoreBy: scoreBy.value }),
    }));
  } catch (error) {
    if (error instanceof AnalysisQueryInputError) return c.json({ error: error.message }, 400);
    return c.json({
      error: safeErrorMessage(
        'GET /api/analysis/hotspots',
        error,
        'Failed to analyze hotspots.',
      ),
    }, 500);
  }
});

analysisRoutes.get('/api/analysis/change-coupling', async (c) => {
  try {
    const since = parseSince(c.req.query('since'));
    if (!since.valid) return c.json({ error: since.error }, 400);
    const minSupport = boundedInteger(c.req.query('minSupport'), 'minSupport', 1, 200);
    if (!minSupport.valid) return c.json({ error: minSupport.error }, 400);
    const project = await resolveProjectRequest(c.req.query('projectId'), c.req.query('limit'), 500);
    if (!project.valid) return c.json({ error: project.error }, project.status);

    return c.json(await codeGraphService.getChangeCoupling({
      ...project.value,
      ...(since.value === undefined ? {} : { since: since.value }),
      ...(minSupport.value === undefined ? {} : { minSupport: minSupport.value }),
    }));
  } catch (error) {
    if (error instanceof AnalysisQueryInputError) return c.json({ error: error.message }, 400);
    return c.json({
      error: safeErrorMessage(
        'GET /api/analysis/change-coupling',
        error,
        'Failed to analyze change coupling.',
      ),
    }, 500);
  }
});
