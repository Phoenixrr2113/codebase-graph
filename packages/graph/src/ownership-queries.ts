import type {
  FileOwnershipItem,
  HistoryCoverage,
  NormalizedOwnershipInput,
  OwnershipInput,
  OwnershipResult,
} from '@codegraph/types';
import { isAbsolute, relative, resolve, win32 } from 'node:path';
import type { GraphClient } from './client';

const CONTRIBUTOR_LIMIT = 10;
const CONTRIBUTOR_QUERY_CONCURRENCY = 5;
const ISO_DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,3}))?(?:Z|[+-]\d{2}:\d{2}))?$/;

interface FileCandidateRow {
  filePath: string;
  commitCount: number;
}

interface ContributorRow {
  authorName: string;
  authorEmail: string;
  commitCount: number;
}

interface OwnershipCoverageRow {
  commitCount?: number;
  earliestCommitDate?: string | null;
  latestCommitDate?: string | null;
  totalCommitCount?: number | null;
  historySince?: string | null;
  historyMaxCommits?: number | null;
  historyWindowSize?: number | null;
  historyTruncated?: boolean | null;
  historyComplete?: boolean | null;
  unknownIdentityCommitCount?: number;
}

export class AnalysisQueryInputError extends Error {
  readonly code = 'INVALID_ANALYSIS_INPUT';

  constructor(message: string) {
    super(message);
    this.name = 'AnalysisQueryInputError';
  }
}

function strictInteger(
  value: number | undefined,
  fallback: number,
  minimum: number,
  maximum: number,
): number {
  if (value === undefined) return fallback;
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
    throw new AnalysisQueryInputError(
      `limit must be an integer between ${minimum} and ${maximum}`,
    );
  }
  return value;
}

function normalizeRootPath(rootPath: string): string {
  return resolve(rootPath).replaceAll('\\', '/');
}

function pathWithSeparator(path: string): string {
  return path === '/' ? '/' : `${path}/`;
}

function hasExactCalendarFields(value: string): boolean {
  const match = ISO_DATE_PATTERN.exec(value);
  if (match === null) return false;

  const [, year, month, day, hour = '0', minute = '0', second = '0', fraction = '0'] = match;
  const expected = {
    year: Number(year),
    month: Number(month),
    day: Number(day),
    hour: Number(hour),
    minute: Number(minute),
    second: Number(second),
    millisecond: Number(fraction.padEnd(3, '0')),
  };
  const reconstructed = new Date(0);
  reconstructed.setUTCFullYear(expected.year, expected.month - 1, expected.day);
  reconstructed.setUTCHours(
    expected.hour,
    expected.minute,
    expected.second,
    expected.millisecond,
  );
  return reconstructed.getUTCFullYear() === expected.year
    && reconstructed.getUTCMonth() === expected.month - 1
    && reconstructed.getUTCDate() === expected.day
    && reconstructed.getUTCHours() === expected.hour
    && reconstructed.getUTCMinutes() === expected.minute
    && reconstructed.getUTCSeconds() === expected.second
    && reconstructed.getUTCMilliseconds() === expected.millisecond;
}

export function normalizeAnalysisSince(since: string | undefined): string | null {
  if (since === undefined) return null;
  if (typeof since !== 'string' || !hasExactCalendarFields(since)) {
    throw new AnalysisQueryInputError('since must be a valid ISO 8601 date');
  }
  const date = new Date(since);
  if (Number.isNaN(date.getTime())) {
    throw new AnalysisQueryInputError('since must be a valid ISO 8601 date');
  }
  return date.toISOString();
}

export function normalizeOwnershipPathPrefix(
  rootPath: string,
  pathPrefix: string | undefined,
): string | null {
  if (pathPrefix === undefined || pathPrefix === '') return null;
  if (typeof pathPrefix !== 'string') {
    throw new AnalysisQueryInputError('pathPrefix must be a string');
  }

  const normalizedSeparators = pathPrefix.trim().replaceAll('\\', '/');
  if (isAbsolute(normalizedSeparators) || win32.isAbsolute(pathPrefix)) {
    throw new AnalysisQueryInputError('pathPrefix must be project-relative');
  }
  if (normalizedSeparators.split('/').includes('..')) {
    throw new AnalysisQueryInputError('pathPrefix must not contain .. traversal segments');
  }

  const normalizedRoot = normalizeRootPath(rootPath);
  const resolvedPrefix = resolve(normalizedRoot, normalizedSeparators).replaceAll('\\', '/');
  const relativePrefix = relative(normalizedRoot, resolvedPrefix).replaceAll('\\', '/');
  if (relativePrefix === '..' || relativePrefix.startsWith('../') || isAbsolute(relativePrefix)) {
    throw new AnalysisQueryInputError('pathPrefix must resolve within projectPath');
  }
  return resolvedPrefix;
}

function toHistoryCoverage(row: OwnershipCoverageRow | undefined): HistoryCoverage {
  const historyMaxCommits = row?.historyMaxCommits ?? row?.historyWindowSize ?? null;
  return {
    commitCount: row?.commitCount ?? 0,
    earliestCommitDate: row?.earliestCommitDate ?? null,
    latestCommitDate: row?.latestCommitDate ?? null,
    totalCommitCount: row?.totalCommitCount ?? null,
    historySince: row?.historySince ?? null,
    historyMaxCommits,
    historyWindowSize: historyMaxCommits,
    historyTruncated: row?.historyTruncated === true,
    historyComplete: row?.historyComplete === true,
  };
}

function observedRange(coverage: HistoryCoverage): string {
  if (coverage.earliestCommitDate === null || coverage.latestCommitDate === null) {
    return 'no matching commit dates were observed';
  }
  return `observed matching commits span ${coverage.earliestCommitDate} through ${coverage.latestCommitDate}`;
}

function coverageSentence(coverage: HistoryCoverage): string {
  if (coverage.historyTruncated) {
    const ceiling = coverage.historyMaxCommits === null
      ? 'an unavailable commit ceiling'
      : `at most ${coverage.historyMaxCommits} commits`;
    return `Indexed history is truncated to ${ceiling}; ${observedRange(coverage)}.`;
  }
  if (coverage.historyComplete) {
    return 'Indexed history includes the complete reachable branch history available at the last history sync.';
  }
  return 'Indexed history completeness could not be verified.';
}

function ownershipCaveats(
  coverage: HistoryCoverage,
  unknownIdentityCommitCount: number,
): string[] {
  return [
    'Ownership is inferred from authorship in indexed git history, not from CODEOWNERS, review activity, expertise, or current team assignment.',
    `Results cover only the indexed history and the requested filters. ${coverageSentence(coverage)}`,
    'Bot and automation commits are included and can dominate rankings.',
    "Renames and moves can split or undercount a file's history because history edges are attached to indexed File paths.",
    'Author aliases that remain after git mailmap are ranked separately.',
    ...(unknownIdentityCommitCount > 0
      ? ['Some indexed commits have no usable author identity. Reindex history to backfill them.']
      : []),
  ];
}

async function mapWithConcurrency<T, R>(
  values: readonly T[],
  concurrency: number,
  mapper: (value: T) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(values.length);
  let nextIndex = 0;

  const worker = async (): Promise<void> => {
    while (nextIndex < values.length) {
      const index = nextIndex;
      nextIndex += 1;
      const value = values[index];
      if (value !== undefined) results[index] = await mapper(value);
    }
  };

  const workerCount = Math.min(concurrency, values.length);
  await Promise.all(Array.from({ length: workerCount }, () => worker()));
  return results;
}

export type OwnershipQuery = (input: OwnershipInput) => Promise<OwnershipResult>;

export function createOwnershipQuery(client: GraphClient): OwnershipQuery {
  return async (input: OwnershipInput): Promise<OwnershipResult> => {
    const rootPath = normalizeRootPath(input.rootPath);
    const since = normalizeAnalysisSince(input.since);
    const pathPrefix = normalizeOwnershipPathPrefix(rootPath, input.pathPrefix);
    const limit = strictInteger(input.limit, 50, 1, 500);
    const normalizedInput: NormalizedOwnershipInput = { rootPath, since, pathPrefix, limit };
    const scopeParams = {
      rootPath,
      rootPathPrefix: pathWithSeparator(rootPath),
      since,
      pathPrefix,
      pathPrefixWithSeparator: pathPrefix === null ? null : pathWithSeparator(pathPrefix),
    };

    const fileResult = await client.roQuery<FileCandidateRow>(`
      MATCH (f:File)-[:MODIFIED_IN]->(c:Commit)
      WHERE (f.filePath = $rootPath OR f.filePath STARTS WITH $rootPathPrefix)
        AND ($pathPrefix IS NULL OR f.filePath = $pathPrefix OR f.filePath STARTS WITH $pathPrefixWithSeparator)
        AND ($since IS NULL OR c.date >= $since)
      WITH f.filePath AS filePath, count(DISTINCT c) AS commitCount
      RETURN filePath, commitCount
      ORDER BY commitCount DESC, filePath ASC
      LIMIT $rowLimit
    `, { params: { ...scopeParams, rowLimit: limit + 1 } });

    const fileRows = fileResult.data ?? [];
    const returnedFiles = fileRows.slice(0, limit);
    const itemsPromise = mapWithConcurrency(
      returnedFiles,
      CONTRIBUTOR_QUERY_CONCURRENCY,
      async (file): Promise<FileOwnershipItem> => {
        const contributorResult = await client.roQuery<ContributorRow>(`
          MATCH (f:File {filePath: $filePath})-[:MODIFIED_IN]->(c:Commit)
          WHERE ($since IS NULL OR c.date >= $since)
            AND trim(coalesce(c.author, '')) <> ''
            AND trim(coalesce(c.email, '')) <> ''
          WITH c.email AS authorEmail,
               c.author AS authorName,
               count(DISTINCT c) AS commitCount
          RETURN authorName, authorEmail, commitCount
          ORDER BY commitCount DESC, authorEmail ASC, authorName ASC
          LIMIT $rowLimit
        `, {
          params: {
            filePath: file.filePath,
            since,
            rowLimit: CONTRIBUTOR_LIMIT + 1,
          },
        });
        const contributorRows = contributorResult.data ?? [];
        return {
          filePath: file.filePath,
          commitCount: file.commitCount,
          contributors: contributorRows.slice(0, CONTRIBUTOR_LIMIT).map((contributor) => ({
            ...contributor,
            sharePercentage: Math.round(
              (contributor.commitCount / file.commitCount) * 10_000,
            ) / 100,
          })),
          contributorsTruncated: contributorRows.length > CONTRIBUTOR_LIMIT,
        };
      },
    );

    const coveragePromise = client.roQuery<OwnershipCoverageRow>(`
      MATCH (project:Project {rootPath: $rootPath})
      OPTIONAL MATCH (f:File)-[:MODIFIED_IN]->(c:Commit)
      WHERE (f.filePath = $rootPath OR f.filePath STARTS WITH $rootPathPrefix)
        AND ($pathPrefix IS NULL OR f.filePath = $pathPrefix OR f.filePath STARTS WITH $pathPrefixWithSeparator)
        AND ($since IS NULL OR c.date >= $since)
      RETURN count(DISTINCT c) AS commitCount,
             min(c.date) AS earliestCommitDate,
             max(c.date) AS latestCommitDate,
             project.gitHistoryTotalCommits AS totalCommitCount,
             project.gitHistorySince AS historySince,
             coalesce(project.gitHistoryMaxCommits, project.gitHistoryWindowSize) AS historyMaxCommits,
             coalesce(project.gitHistoryMaxCommits, project.gitHistoryWindowSize) AS historyWindowSize,
             project.gitHistoryTruncated AS historyTruncated,
             project.gitHistoryComplete AS historyComplete,
             count(DISTINCT CASE
               WHEN c IS NOT NULL AND (
                 trim(coalesce(c.author, '')) = '' OR trim(coalesce(c.email, '')) = ''
               ) THEN c.hash
               ELSE null
             END) AS unknownIdentityCommitCount
    `, { params: scopeParams });

    const [items, coverageResult] = await Promise.all([itemsPromise, coveragePromise]);
    const coverageRow = coverageResult.data?.[0];
    const historyCoverage = toHistoryCoverage(coverageRow);
    const unknownIdentityCommitCount = coverageRow?.unknownIdentityCommitCount ?? 0;

    return {
      input: normalizedInput,
      projectRoot: rootPath,
      items,
      truncated: fileRows.length > limit,
      unknownIdentityCommitCount,
      historyCoverage,
      caveats: ownershipCaveats(historyCoverage, unknownIdentityCommitCount),
    };
  };
}
