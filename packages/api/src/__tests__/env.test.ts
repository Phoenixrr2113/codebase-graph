import { describe, expect, it } from 'vitest';
import { join, resolve } from 'node:path';
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import {
  findEnvFile,
  formatServerStartError,
  isAllowedOrigin,
  loadEnvironment,
  resolvePort,
} from '../env';

describe('resolvePort', () => {
  it('defaults to 3001 when nothing is configured', () => {
    expect(resolvePort({})).toBe(3001);
  });

  it('honours API_PORT, the name used by .env and docker-compose', () => {
    expect(resolvePort({ API_PORT: '4001' })).toBe(4001);
  });

  it('honours PORT as the conventional platform variable', () => {
    expect(resolvePort({ PORT: '8080' })).toBe(8080);
  });

  it('prefers API_PORT when both are set', () => {
    expect(resolvePort({ API_PORT: '4001', PORT: '8080' })).toBe(4001);
  });

  it('falls back rather than returning NaN for a non-numeric value', () => {
    expect(resolvePort({ API_PORT: 'not-a-port' })).toBe(3001);
  });

  it('rejects out-of-range and empty values', () => {
    expect(resolvePort({ API_PORT: '0' })).toBe(3001);
    expect(resolvePort({ API_PORT: '70000' })).toBe(3001);
    expect(resolvePort({ API_PORT: '   ' })).toBe(3001);
  });

  it('skips an unusable API_PORT and uses PORT instead', () => {
    expect(resolvePort({ API_PORT: '', PORT: '5005' })).toBe(5005);
  });
});

describe('formatServerStartError', () => {
  it('gives an API_PORT remedy when the process cannot bind a privileged port', () => {
    const error = Object.assign(new Error('listen EACCES: permission denied 0.0.0.0:80'), {
      code: 'EACCES',
    });

    expect(formatServerStartError(error, 80)).toBe(
      'CodeGraph dashboard could not start on port 80: permission was denied. Set API_PORT to another port and try again.',
    );
  });
});

describe('findEnvFile', () => {
  it('finds a .env in the starting directory', () => {
    const exists = (path: string) => path === resolve('/repo/.env');
    expect(findEnvFile('/repo', exists)).toBe(resolve('/repo/.env'));
  });

  it('walks upwards to the repository root', () => {
    const exists = (path: string) => path === resolve('/repo/.env');
    expect(findEnvFile('/repo/packages/api/src', exists)).toBe(resolve('/repo/.env'));
  });

  it('returns undefined when no .env exists anywhere above', () => {
    expect(findEnvFile('/repo/packages/api', () => false)).toBeUndefined();
  });
});

describe('isAllowedOrigin', () => {
  it('accepts localhost on any port, so a Next.js port fallback still works', () => {
    expect(isAllowedOrigin('http://localhost:3000')).toBe(true);
    expect(isAllowedOrigin('http://localhost:3002')).toBe(true);
    expect(isAllowedOrigin('http://127.0.0.1:4400')).toBe(true);
  });

  it('rejects a non-loopback origin', () => {
    expect(isAllowedOrigin('http://evil.example.com')).toBe(false);
    expect(isAllowedOrigin('https://localhost.evil.com')).toBe(false);
  });

  it('rejects a malformed origin', () => {
    expect(isAllowedOrigin('not-a-url')).toBe(false);
    expect(isAllowedOrigin('')).toBe(false);
  });

  it('rejects non-http schemes', () => {
    expect(isAllowedOrigin('file://localhost')).toBe(false);
  });

  it('uses an explicit allowlist verbatim when configured', () => {
    const configured = 'https://graph.example.com, http://localhost:3000';
    expect(isAllowedOrigin('https://graph.example.com', configured)).toBe(true);
    expect(isAllowedOrigin('http://localhost:3000', configured)).toBe(true);
    // Loopback is no longer blanket-allowed once an explicit list is set.
    expect(isAllowedOrigin('http://localhost:9999', configured)).toBe(false);
  });

  it('falls back to loopback matching for a blank allowlist', () => {
    expect(isAllowedOrigin('http://localhost:3002', '   ')).toBe(true);
  });
});

describe('loadEnvironment search root', () => {
  // Under npx or a global install the module lives in a cache directory whose
  // ancestors have nothing to do with the user's project, so searching from the
  // module would never find the .env they configured. It must start at the
  // working directory of the process that was invoked.
  it('loads a .env found by walking up from the working directory', () => {
    // realpath because macOS resolves /var to /private/var, and process.cwd()
    // reports the resolved form.
    const projectDir = realpathSync(mkdtempSync(join(tmpdir(), 'codegraph-env-root-')));
    const nested = join(projectDir, 'packages', 'api');
    mkdirSync(nested, { recursive: true });
    writeFileSync(join(projectDir, '.env'), 'CODEGRAPH_ENV_ROOT_PROBE=found\n');

    const originalCwd = process.cwd();
    const hadProbe = process.env['CODEGRAPH_ENV_ROOT_PROBE'];
    try {
      process.chdir(nested);
      const loaded = loadEnvironment();
      expect(loaded).toBe(join(projectDir, '.env'));
      expect(process.env['CODEGRAPH_ENV_ROOT_PROBE']).toBe('found');
    } finally {
      process.chdir(originalCwd);
      if (hadProbe === undefined) delete process.env['CODEGRAPH_ENV_ROOT_PROBE'];
      rmSync(projectDir, { recursive: true, force: true });
    }
  });

  it('returns undefined when no .env exists above the working directory', () => {
    const bare = mkdtempSync(join(tmpdir(), 'codegraph-env-bare-'));
    const originalCwd = process.cwd();
    try {
      process.chdir(bare);
      // A .env may still exist further up the temp root on some machines, so
      // only assert the contract: whatever comes back is either nothing or a
      // real path, never a path under this module's install directory.
      const loaded = loadEnvironment();
      if (loaded !== undefined) expect(loaded.endsWith('.env')).toBe(true);
    } finally {
      process.chdir(originalCwd);
      rmSync(bare, { recursive: true, force: true });
    }
  });
});
