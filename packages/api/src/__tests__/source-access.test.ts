/**
 * The source endpoint serves the code behind a graph node. That is a much
 * narrower need than "read any file", and the API listens on localhost where
 * anything on the machine can reach it, so the boundary is worth pinning down.
 */

import { describe, it, expect } from 'vitest';
import { authorizeSourcePath, isInsideRoot } from '../source-access';

const PROJECT = '/work/project';
const OTHER = '/work/other';

/** Stands in for the filesystem: every path resolves to itself unless mapped. */
function fakeRealpath(links: Record<string, string> = {}, missing: string[] = []) {
  return (path: string): string => {
    if (missing.includes(path)) {
      throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
    }
    return links[path] ?? path;
  };
}

describe('isInsideRoot', () => {
  it('accepts the root itself and anything under it', () => {
    expect(isInsideRoot('/work/project', '/work/project')).toBe(true);
    expect(isInsideRoot('/work/project/src/a.ts', '/work/project')).toBe(true);
  });

  it('does not treat a sibling with a shared prefix as inside', () => {
    expect(isInsideRoot('/work/project-secrets/a.ts', '/work/project')).toBe(false);
    expect(isInsideRoot('/work/projectile', '/work/project')).toBe(false);
  });

  it('tolerates a trailing separator on the root', () => {
    expect(isInsideRoot('/work/project/src/a.ts', '/work/project/')).toBe(true);
  });
});

describe('authorizeSourcePath', () => {
  it('allows a file inside an indexed project', () => {
    const decision = authorizeSourcePath(`${PROJECT}/src/a.ts`, [PROJECT], fakeRealpath());
    expect(decision).toEqual({ ok: true, path: `${PROJECT}/src/a.ts` });
  });

  it('refuses a file outside every project', () => {
    const decision = authorizeSourcePath('/Users/someone/.ssh/id_rsa', [PROJECT], fakeRealpath());
    expect(decision).toMatchObject({ ok: false, status: 403 });
  });

  it('refuses a traversal that climbs out of a project', () => {
    const decision = authorizeSourcePath(`${PROJECT}/../../etc/passwd`, [PROJECT], fakeRealpath());
    expect(decision).toMatchObject({ ok: false, status: 403 });
  });

  it('refuses a symlink inside a project that points outside it', () => {
    const decision = authorizeSourcePath(
      `${PROJECT}/link.ts`,
      [PROJECT],
      fakeRealpath({ [`${PROJECT}/link.ts`]: '/etc/shadow' }),
    );
    expect(decision).toMatchObject({ ok: false, status: 403 });
  });

  it('follows a symlink that stays inside the project', () => {
    const decision = authorizeSourcePath(
      `${PROJECT}/link.ts`,
      [PROJECT],
      fakeRealpath({ [`${PROJECT}/link.ts`]: `${PROJECT}/src/real.ts` }),
    );
    expect(decision).toEqual({ ok: true, path: `${PROJECT}/src/real.ts` });
  });

  it('rejects a relative path rather than resolving it against the server', () => {
    const decision = authorizeSourcePath('src/a.ts', [PROJECT], fakeRealpath());
    expect(decision).toMatchObject({ ok: false, status: 400 });
    expect((decision as { message: string }).message).toContain('absolute');
  });

  it('rejects an embedded null byte', () => {
    const decision = authorizeSourcePath(`${PROJECT}/a.ts\0.png`, [PROJECT], fakeRealpath());
    expect(decision).toMatchObject({ ok: false, status: 400 });
  });

  it('requires a path at all', () => {
    expect(authorizeSourcePath(undefined, [PROJECT], fakeRealpath())).toMatchObject({
      ok: false,
      status: 400,
    });
  });

  it('reports a missing file as missing, not as forbidden', () => {
    const target = `${PROJECT}/gone.ts`;
    const decision = authorizeSourcePath(target, [PROJECT], fakeRealpath({}, [target]));
    expect(decision).toMatchObject({ ok: false, status: 404 });
  });

  it('reads nothing when no project is configured', () => {
    const decision = authorizeSourcePath(`${PROJECT}/src/a.ts`, [], fakeRealpath());
    expect(decision).toMatchObject({ ok: false, status: 403 });
  });

  it('accepts a file in any one of several projects', () => {
    const decision = authorizeSourcePath(`${OTHER}/src/b.ts`, [PROJECT, OTHER], fakeRealpath());
    expect(decision).toEqual({ ok: true, path: `${OTHER}/src/b.ts` });
  });

  it('skips a configured root that no longer exists', () => {
    const decision = authorizeSourcePath(
      `${PROJECT}/src/a.ts`,
      ['/gone', PROJECT],
      fakeRealpath({}, ['/gone']),
    );
    expect(decision).toEqual({ ok: true, path: `${PROJECT}/src/a.ts` });
  });
});
