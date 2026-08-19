import { describe, expect, it } from 'vitest';
import { resolve } from 'node:path';
import { findEnvFile, isAllowedOrigin, resolvePort } from '../env';

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
