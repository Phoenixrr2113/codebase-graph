import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import {
  contentTypeFor,
  findDashboardAsset,
  isAssetRequest,
  resolveStaticPath,
} from '../static';

let root: string;
let outside: string;

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), 'codegraph-static-'));
  mkdirSync(join(root, 'assets'), { recursive: true });
  writeFileSync(join(root, 'index.html'), '<!doctype html><title>dash</title>');
  writeFileSync(join(root, 'assets', 'index-AbCdEfGh12.js'), 'console.log(1)');
  writeFileSync(join(root, 'assets', 'plain.js'), 'console.log(2)');

  outside = mkdtempSync(join(tmpdir(), 'codegraph-secret-'));
  writeFileSync(join(outside, 'secret.txt'), 'do not serve me');
});

afterAll(() => {
  rmSync(root, { recursive: true, force: true });
  rmSync(outside, { recursive: true, force: true });
});

describe('resolveStaticPath', () => {
  it('resolves a normal path inside the root', () => {
    expect(resolveStaticPath('/index.html', root)).toBe(join(resolve(root), 'index.html'));
  });

  // The guarantee is containment: a traversal attempt must never resolve to a
  // path outside the root. It is allowed to resolve to a harmless path inside
  // the root that simply does not exist.
  it('contains a traversal attempt inside the root', () => {
    const resolved = resolveStaticPath('/../../etc/passwd', root);
    expect(resolved).not.toBeNull();
    expect(resolved!.startsWith(resolve(root))).toBe(true);
  });

  it('contains an encoded traversal attempt inside the root', () => {
    const resolved = resolveStaticPath('/%2e%2e%2f%2e%2e%2fetc/passwd', root);
    expect(resolved).not.toBeNull();
    expect(resolved!.startsWith(resolve(root))).toBe(true);
  });

  it('contains a relative traversal that climbs above the root', () => {
    const resolved = resolveStaticPath('assets/../../../etc/passwd', root);
    expect(resolved).not.toBeNull();
    expect(resolved!.startsWith(resolve(root))).toBe(true);
  });

  it('refuses a path containing a null byte', () => {
    expect(resolveStaticPath('/index.html%00.png', root)).toBeNull();
  });

  it('refuses malformed percent-encoding', () => {
    expect(resolveStaticPath('/%E0%A4%A', root)).toBeNull();
  });

  it('ignores a query string', () => {
    expect(resolveStaticPath('/index.html?v=2', root)).toBe(join(resolve(root), 'index.html'));
  });
});

describe('isAssetRequest', () => {
  it('treats a file extension as an asset', () => {
    expect(isAssetRequest('/assets/index-AbCdEfGh12.js')).toBe(true);
  });

  it('treats an extensionless route as an application route', () => {
    expect(isAssetRequest('/settings/projects')).toBe(false);
  });
});

describe('contentTypeFor', () => {
  it('maps the types a Vite build emits', () => {
    expect(contentTypeFor('a.js')).toContain('text/javascript');
    expect(contentTypeFor('a.css')).toContain('text/css');
    expect(contentTypeFor('a.html')).toContain('text/html');
    expect(contentTypeFor('a.woff2')).toBe('font/woff2');
  });

  it('falls back to a binary type for anything unknown', () => {
    expect(contentTypeFor('a.unknownext')).toBe('application/octet-stream');
  });
});

describe('findDashboardAsset', () => {
  it('serves an existing asset', () => {
    const found = findDashboardAsset('/assets/index-AbCdEfGh12.js', root);
    expect(found?.contentType).toContain('text/javascript');
    expect(found?.size).toBeGreaterThan(0);
  });

  it('marks content addressed assets immutable', () => {
    expect(findDashboardAsset('/assets/index-AbCdEfGh12.js', root)?.immutable).toBe(true);
  });

  it('does not mark an unhashed asset immutable', () => {
    expect(findDashboardAsset('/assets/plain.js', root)?.immutable).toBe(false);
  });

  it('falls back to index.html for an application route', () => {
    const found = findDashboardAsset('/some/client/route', root);
    expect(found?.path).toBe(join(resolve(root), 'index.html'));
  });

  it('returns null for a missing asset rather than falling back', () => {
    expect(findDashboardAsset('/assets/does-not-exist.js', root)).toBeNull();
  });

  it('serves index.html at the root path', () => {
    expect(findDashboardAsset('/', root)?.path).toBe(join(resolve(root), 'index.html'));
  });

  it('never serves a file from outside the root', () => {
    // This resolves to the app shell through the single-page fallback, which is
    // safe. What must never happen is a file outside the root being returned.
    const found = findDashboardAsset('/../../etc/passwd', root);
    if (found !== null) {
      expect(found.path.startsWith(resolve(root))).toBe(true);
    }
  });

  it('does not leak a real file that exists outside the root', () => {
    const found = findDashboardAsset('/../../' + outside.split('/').pop() + '/secret.txt', root);
    // A .txt request is an asset request, so there is no shell fallback: it must
    // simply not be found, and certainly must not be the file outside the root.
    if (found !== null) {
      expect(found.path.startsWith(resolve(root))).toBe(true);
    }
  });
});
