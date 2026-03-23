/**
 * License validation for CodeGraph commercial distribution.
 *
 * Validates license keys against the Polar.sh API with local caching.
 * Graceful offline fallback: if cache exists and key matches, allow usage.
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { createLogger } from '@codegraph/logger';

const logger = createLogger({ namespace: 'License' });

const LICENSE_DIR = join(homedir(), '.codegraph');
const LICENSE_CACHE_PATH = join(LICENSE_DIR, 'license.json');
const CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

// Set via environment — replaced at Polar.sh setup time
const POLAR_ORG_ID = process.env.CODEGRAPH_POLAR_ORG_ID || '';
const POLAR_VALIDATE_URL = 'https://api.polar.sh/v1/customer-portal/license-keys/validate';

interface CachedLicense {
  key: string;
  customer: string;
  validatedAt: number;
}

interface PolarValidationResponse {
  valid: boolean;
  customer?: { email?: string; name?: string };
  [key: string]: unknown;
}

function readCache(): CachedLicense | null {
  try {
    if (!existsSync(LICENSE_CACHE_PATH)) return null;
    return JSON.parse(readFileSync(LICENSE_CACHE_PATH, 'utf-8')) as CachedLicense;
  } catch {
    return null;
  }
}

function writeCache(cache: CachedLicense): void {
  try {
    if (!existsSync(LICENSE_DIR)) mkdirSync(LICENSE_DIR, { recursive: true });
    writeFileSync(LICENSE_CACHE_PATH, JSON.stringify(cache, null, 2));
  } catch (err) {
    logger.warn('Failed to write license cache', err);
  }
}

function isCacheValid(cache: CachedLicense, key: string): boolean {
  return cache.key === key && (Date.now() - cache.validatedAt) < CACHE_TTL_MS;
}

async function validateWithPolar(key: string): Promise<{ valid: boolean; customer: string }> {
  const body: Record<string, string> = { key };
  if (POLAR_ORG_ID) body.organization_id = POLAR_ORG_ID;

  const response = await fetch(POLAR_VALIDATE_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(10_000),
  });

  if (!response.ok) {
    // 4xx = key is invalid, not a network issue
    if (response.status >= 400 && response.status < 500) {
      return { valid: false, customer: '' };
    }
    throw new Error(`Polar API returned ${response.status}`);
  }

  const data = await response.json() as PolarValidationResponse;
  return {
    valid: Boolean(data.valid),
    customer: data.customer?.email || data.customer?.name || 'unknown',
  };
}

/**
 * Validate the license key. Called at MCP server startup.
 *
 * Flow:
 * 1. Check local cache (valid for 7 days)
 * 2. Validate with Polar.sh API
 * 3. If offline and cache exists (even expired), allow grace period
 * 4. If no key or invalid, exit with instructions
 */
export async function requireLicense(): Promise<void> {
  const key = process.env.CODEGRAPH_LICENSE;

  if (!key) {
    process.stderr.write(
      '\n[CodeGraph] License key required.\n' +
      '  Set CODEGRAPH_LICENSE in your environment or .mcp.json config.\n' +
      '  Purchase at: https://polar.sh/codegraph\n\n'
    );
    process.exit(1);
  }

  // Check cache first
  const cached = readCache();
  if (cached && isCacheValid(cached, key)) {
    logger.info(`License valid (cached) — ${cached.customer}`);
    return;
  }

  // Validate online
  try {
    const result = await validateWithPolar(key);

    if (result.valid) {
      writeCache({ key, customer: result.customer, validatedAt: Date.now() });
      logger.info(`License validated — ${result.customer}`);
      return;
    }

    process.stderr.write(
      '\n[CodeGraph] Invalid or expired license key.\n' +
      '  Purchase or renew at: https://polar.sh/codegraph\n\n'
    );
    process.exit(1);
  } catch (err) {
    // Offline fallback: if we have ANY cache for this key, allow it
    if (cached && cached.key === key) {
      logger.warn('License validation offline — using cached result (grace period)');
      return;
    }

    process.stderr.write(
      '\n[CodeGraph] Unable to validate license (no internet and no cached validation).\n' +
      '  Ensure you have internet for first-time activation.\n\n'
    );
    process.exit(1);
  }
}
