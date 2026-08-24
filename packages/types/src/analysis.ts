/**
 * Ownership analysis contracts.
 * Frozen by the orchestrator for the history/ownership batch. Ownership is
 * inferred authorship from indexed git history; the result contract keeps
 * that framing explicit (authorName/authorEmail, never a bare "owner").
 */

import type { HistoryCoverage } from './history';

export interface OwnershipInput {
  rootPath: string;
  since?: string;
  pathPrefix?: string;
  limit?: number;
}

export interface NormalizedOwnershipInput {
  rootPath: string;
  since: string | null;
  pathPrefix: string | null;
  limit: number;
}

export interface OwnershipContributor {
  authorName: string;
  authorEmail: string;
  commitCount: number;
  sharePercentage: number;
}

export interface FileOwnershipItem {
  filePath: string;
  commitCount: number;
  contributors: OwnershipContributor[];
  contributorsTruncated: boolean;
}

export interface OwnershipResult {
  input: NormalizedOwnershipInput;
  projectRoot: string;
  items: FileOwnershipItem[];
  truncated: boolean;
  unknownIdentityCommitCount: number;
  historyCoverage: HistoryCoverage;
  caveats: string[];
}
