import { describe, it, expect } from 'vitest';
import { applyIgnoreFilter } from '../indexer.js';

describe('applyIgnoreFilter', () => {
  const root = '/repo';

  it('passes files through when no patterns are given', () => {
    const files = ['/repo/src/a.ts', '/repo/src/b.ts'];
    expect(applyIgnoreFilter(files, [], root)).toEqual(files);
  });

  it('filters by glob — node_modules and dist', () => {
    const files = [
      '/repo/src/a.ts',
      '/repo/node_modules/foo/index.ts',
      '/repo/dist/bundle.ts',
      '/repo/src/b.ts',
    ];
    const result = applyIgnoreFilter(
      files,
      ['**/node_modules/**', '**/dist/**'],
      root,
    );
    expect(result).toEqual(['/repo/src/a.ts', '/repo/src/b.ts']);
  });

  it('filters test files by extension glob', () => {
    const files = [
      '/repo/src/foo.ts',
      '/repo/src/foo.test.ts',
      '/repo/src/bar.spec.ts',
    ];
    const result = applyIgnoreFilter(
      files,
      ['**/*.test.ts', '**/*.spec.ts'],
      root,
    );
    expect(result).toEqual(['/repo/src/foo.ts']);
  });

  // The actual bug: when the root itself is inside a directory whose
  // name appears in the ignore list (e.g., a git worktree at
  // .worktrees/<name>/), files inside the root must NOT be filtered.
  // The substring approach used to break this. The relative-path
  // approach correctly only matches against paths INSIDE the root.
  it('does not filter files in a root that lives under a directory matching an ignore pattern', () => {
    const worktreeRoot = '/main/.worktrees/feature';
    const files = [
      '/main/.worktrees/feature/src/a.ts',
      '/main/.worktrees/feature/packages/core/index.ts',
    ];
    const result = applyIgnoreFilter(files, ['.worktrees/'], worktreeRoot);
    expect(result).toEqual(files);  // all preserved — pattern only matches PATHS RELATIVE TO root
  });

  it('respects anchored patterns — leading slash matches only at the gitignore root', () => {
    const files = [
      '/repo/build/output.ts',     // root-level build/ — should be ignored
      '/repo/src/build/helper.ts', // nested build/ — should NOT be ignored when pattern is anchored
    ];
    const result = applyIgnoreFilter(files, ['/build/'], root);
    expect(result).toEqual(['/repo/src/build/helper.ts']);
  });

  it('respects negation patterns — !pattern un-ignores', () => {
    const files = [
      '/repo/logs/app.log',
      '/repo/logs/important.log',
    ];
    const result = applyIgnoreFilter(
      files,
      ['logs/*.log', '!logs/important.log'],
      root,
    );
    expect(result).toEqual(['/repo/logs/important.log']);
  });

  it('skips files outside rootPath rather than crashing', () => {
    const files = ['/elsewhere/foo.ts', '/repo/src/a.ts'];
    const result = applyIgnoreFilter(files, ['**/foo.ts'], root);
    // The /elsewhere/foo.ts is outside rootPath. It either passes through
    // unchanged or is excluded — but the function must not throw.
    expect(result).toContain('/repo/src/a.ts');
  });
});
