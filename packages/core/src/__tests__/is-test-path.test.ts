import { describe, expect, it } from 'vitest';
import { isTestPath } from '../enrichedSearchV2';

describe('isTestPath', () => {
  it.each([
    // Directory-based test layouts
    ['packages/foo/tests/util.py', true],
    ['packages/foo/test/util.go', true],
    ['src/__tests__/foo.ts', true],
    ['packages/foo/src/tests/inner.rs', true],
    // File-suffix conventions
    ['packages/foo/util_test.go', true],
    ['packages/foo/utils.test.ts', true],
    ['packages/foo/utils.spec.ts', true],
    ['packages/foo/utils_spec.rb', true],
    // Real cgbench failure case
    ['psf-requests/tests/test_lowlevel.py', true],
    // Non-test paths must NOT match
    ['packages/foo/util.py', false],
    ['packages/foo/utils.ts', false],
    ['packages/foo/sessions.py', false],
    // Case variations
    ['Packages/Foo/Tests/util.py', true],
    ['Packages/Foo/__Tests__/util.ts', true],
    // Paths that contain "test" but are not test files
    ['packages/foo/protest/util.py', false],
    ['packages/foo/contest.ts', false],
    ['packages/foo/latest.go', false],
  ])('%s → %s', (path, expected) => {
    expect(isTestPath(path)).toBe(expected);
  });
});
