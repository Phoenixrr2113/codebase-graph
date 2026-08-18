import { describe, expect, it } from 'vitest';
import {
  verifyReleaseTag,
  verifyVersionIsUnpublished,
} from '../verify-release-tag.mjs';

describe('verifyReleaseTag', () => {
  it('accepts the exact stable package tag', () => {
    expect(verifyReleaseTag('refs/tags/v0.1.0', 'codegraph-mcp', '0.1.0')).toEqual({
      packageName: 'codegraph-mcp',
      version: '0.1.0',
    });
  });

  it('accepts the exact prerelease package tag', () => {
    expect(verifyReleaseTag(
      'refs/tags/v1.2.3-rc.1',
      'codegraph-mcp',
      '1.2.3-rc.1',
    )).toEqual({
      packageName: 'codegraph-mcp',
      version: '1.2.3-rc.1',
    });
  });

  it('rejects a tag without the v prefix', () => {
    expect(() => verifyReleaseTag(
      'refs/tags/0.1.0',
      'codegraph-mcp',
      '0.1.0',
    )).toThrow('refs/tags/v0.1.0');
  });

  it('rejects a tag that does not match the package version', () => {
    expect(() => verifyReleaseTag(
      'refs/tags/v0.2.0',
      'codegraph-mcp',
      '0.1.0',
    )).toThrow(/v0\.1\.0/);
  });

  it('rejects the wrong package name', () => {
    expect(() => verifyReleaseTag(
      'refs/tags/v0.1.0',
      '@codegraph/mcp',
      '0.1.0',
    )).toThrow('codegraph-mcp');
  });

  it.each([
    '1.0',
    'v1.0.0',
    '01.0.0',
    '1.0.0-',
    '1.0.0+bad metadata',
  ])('rejects invalid semantic version %s', (version) => {
    expect(() => verifyReleaseTag(
      `refs/tags/v${version}`,
      'codegraph-mcp',
      version,
    )).toThrow('valid semantic version');
  });
});

describe('verifyVersionIsUnpublished', () => {
  it('accepts npm E404 as an unpublished version', () => {
    expect(() => verifyVersionIsUnpublished({
      status: 1,
      stderr: 'npm error code E404\nnpm error 404 Not Found',
      stdout: '',
    }, 'codegraph-mcp', '0.1.0')).not.toThrow();
  });

  it('rejects a version that already exists', () => {
    expect(() => verifyVersionIsUnpublished({
      status: 0,
      stderr: '',
      stdout: '"0.1.0"\n',
    }, 'codegraph-mcp', '0.1.0')).toThrow('already exists');
  });

  it('does not treat authentication or network failures as availability', () => {
    expect(() => verifyVersionIsUnpublished({
      status: 1,
      stderr: 'npm error code E401',
      stdout: '',
    }, 'codegraph-mcp', '0.1.0')).toThrow('Unable to verify');
  });
});
