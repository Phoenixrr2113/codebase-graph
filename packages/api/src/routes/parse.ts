import { Hono } from 'hono';
import { indexProject } from '@codegraph/core';
import { safeErrorMessage } from '../safe-error.js';

export const parseRoutes = new Hono();
const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2}))?$/;

function isValidIsoDateOrTimestamp(value: string): boolean {
  if (!ISO_DATE_PATTERN.test(value) || !Number.isFinite(Date.parse(value))) return false;
  const year = Number(value.slice(0, 4));
  const month = Number(value.slice(5, 7));
  const day = Number(value.slice(8, 10));
  const reconstructed = new Date(0);
  reconstructed.setUTCHours(0, 0, 0, 0);
  reconstructed.setUTCFullYear(year, month - 1, day);
  return reconstructed.getUTCFullYear() === year
    && reconstructed.getUTCMonth() === month - 1
    && reconstructed.getUTCDate() === day;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function validHistorySince(value: unknown): value is string | undefined {
  if (value === undefined) return true;
  if (typeof value !== 'string') return false;
  return isValidIsoDateOrTimestamp(value);
}

function validHistoryMaxCommits(value: unknown): value is number | undefined {
  return value === undefined
    || (typeof value === 'number' && Number.isSafeInteger(value) && value >= 1 && value <= 100_000);
}

/** POST /api/parse/project — index a project directory */
parseRoutes.post('/api/parse/project', async (c) => {
  try {
    const rawBody: unknown = await c.req.json();
    const body = isRecord(rawBody) ? rawBody : {};
    const path = body['path'];

    if (typeof path !== 'string' || path.length === 0) {
      return c.json({ error: 'path field is required' }, 400);
    }
    const historySince = body['historySince'];
    if (!validHistorySince(historySince)) {
      return c.json({ error: 'historySince must be a valid ISO 8601 date or timestamp' }, 400);
    }
    const historyMaxCommits = body['historyMaxCommits'];
    if (!validHistoryMaxCommits(historyMaxCommits)) {
      return c.json({ error: 'historyMaxCommits must be a safe integer between 1 and 100000' }, 400);
    }

    const result = await indexProject(path, {
      ...(historySince !== undefined && { historySince }),
      ...(historyMaxCommits !== undefined && { historyMaxCommits }),
    });

    // indexProject reports a bad path as success: false with the reason in
    // errorMessages. Reporting that as 200 with parsed: true told callers the
    // work had been done, and the dashboard duly showed a green "0 files".
    if (!result.success) {
      return c.json({ parsed: false, path, ...result }, 400);
    }

    return c.json({
      parsed: true,
      path,
      ...result,
    });
  } catch (error) {
    return c.json({ error: safeErrorMessage('POST /api/parse/project', error, 'Parse failed.') }, 500);
  }
});
