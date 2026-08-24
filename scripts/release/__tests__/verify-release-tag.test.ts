import { describe, expect, it } from 'vitest';
import {
  verifyBootstrapRelease,
  verifyReleaseTag,
  verifyVersionIsPublished,
  verifyVersionIsUnpublished,
} from '../verify-release-tag.mjs';

describe('verifyReleaseTag', () => {
  it('accepts the exact stable package tag', () => {
    expect(verifyReleaseTag('refs/tags/v0.1.0', '@codegraph/mcp', '0.1.0')).toEqual({
      packageName: '@codegraph/mcp',
      version: '0.1.0',
    });
  });

  it('rejects prerelease versions until a non-latest dist-tag policy exists', () => {
    expect(() => verifyReleaseTag(
      'refs/tags/v1.2.3-rc.1',
      '@codegraph/mcp',
      '1.2.3-rc.1',
    )).toThrow('stable');
  });

  it('rejects a tag without the v prefix', () => {
    expect(() => verifyReleaseTag(
      'refs/tags/0.1.0',
      '@codegraph/mcp',
      '0.1.0',
    )).toThrow('refs/tags/v0.1.0');
  });

  it('rejects a tag that does not match the package version', () => {
    expect(() => verifyReleaseTag(
      'refs/tags/v0.2.0',
      '@codegraph/mcp',
      '0.1.0',
    )).toThrow(/v0\.1\.0/);
  });

  it('rejects the wrong package name', () => {
    expect(() => verifyReleaseTag(
      'refs/tags/v0.1.0',
      'codegraph-mcp',
      '0.1.0',
    )).toThrow('@codegraph/mcp');
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
      '@codegraph/mcp',
      version,
    )).toThrow('valid semantic version');
  });
});

describe('verifyBootstrapRelease', () => {
  const reviewedCommit = '0123456789abcdef0123456789abcdef01234567';

  it('accepts the one-time 0.1.0 bootstrap from main', () => {
    expect(verifyBootstrapRelease(
      'refs/heads/main',
      '0.1.0',
      reviewedCommit,
      '@codegraph/mcp',
      '0.1.0',
    )).toEqual({
      packageName: '@codegraph/mcp',
      version: '0.1.0',
      reviewedCommit,
    });
  });

  it('rejects a bootstrap from a branch other than main', () => {
    expect(() => verifyBootstrapRelease(
      'refs/heads/release',
      '0.1.0',
      reviewedCommit,
      '@codegraph/mcp',
      '0.1.0',
    )).toThrow('main');
  });

  it('rejects a bootstrap version other than 0.1.0', () => {
    expect(() => verifyBootstrapRelease(
      'refs/heads/main',
      '0.2.0',
      reviewedCommit,
      '@codegraph/mcp',
      '0.2.0',
    )).toThrow('0.1.0');
  });

  it('rejects input that does not match the package version', () => {
    expect(() => verifyBootstrapRelease(
      'refs/heads/main',
      '0.1.0',
      reviewedCommit,
      '@codegraph/mcp',
      '0.1.1',
    )).toThrow('match');
  });

  it('rejects a missing or abbreviated reviewed commit', () => {
    expect(() => verifyBootstrapRelease(
      'refs/heads/main',
      '0.1.0',
      '0123456',
      '@codegraph/mcp',
      '0.1.0',
    )).toThrow('40-character');
  });
});

describe('verifyVersionIsUnpublished', () => {
  it('accepts npm E404 as an unpublished version', () => {
    expect(() => verifyVersionIsUnpublished({
      status: 1,
      stderr: 'npm error code E404\nnpm error 404 Not Found',
      stdout: '',
    }, '@codegraph/mcp', '0.1.0')).not.toThrow();
  });

  it('rejects a version that already exists', () => {
    expect(() => verifyVersionIsUnpublished({
      status: 0,
      stderr: '',
      stdout: '"0.1.0"\n',
    }, '@codegraph/mcp', '0.1.0')).toThrow('already exists');
  });

  it('does not treat authentication or network failures as availability', () => {
    expect(() => verifyVersionIsUnpublished({
      status: 1,
      stderr: 'npm error code E401',
      stdout: '',
    }, '@codegraph/mcp', '0.1.0')).toThrow('Unable to verify');
  });
});

describe('verifyVersionIsPublished', () => {
  it('accepts an exact published version', () => {
    expect(() => verifyVersionIsPublished({
      status: 0,
      stderr: '',
      stdout: '"0.1.0"\n',
    }, '@codegraph/mcp', '0.1.0')).not.toThrow();
  });

  it('rejects a missing package version', () => {
    expect(() => verifyVersionIsPublished({
      status: 1,
      stderr: 'npm error code E404',
      stdout: '',
    }, '@codegraph/mcp', '0.1.0')).toThrow('must already exist');
  });

  it('rejects an unexpected published version response', () => {
    expect(() => verifyVersionIsPublished({
      status: 0,
      stderr: '',
      stdout: '"0.1.1"\n',
    }, '@codegraph/mcp', '0.1.0')).toThrow('expected 0.1.0');
  });
});
