import { describe, expect, it, vi } from 'vitest';
import { resolveEmbeddedBinaryPaths } from '../drivers/falkordblite';

describe('resolveEmbeddedBinaryPaths', () => {
  it('resolves the pinned direct platform package on Apple silicon', () => {
    const resolvePackage = vi.fn().mockReturnValue(
      '/runtime/@falkordblite/darwin-arm64/package.json',
    );

    expect(resolveEmbeddedBinaryPaths('darwin', 'arm64', resolvePackage)).toEqual({
      redisServerPath: '/runtime/@falkordblite/darwin-arm64/bin/redis-server',
      modulePath: '/runtime/@falkordblite/darwin-arm64/bin/falkordb.so',
    });
    expect(resolvePackage).toHaveBeenCalledWith('@falkordblite/darwin-arm64/package.json');
  });

  it('leaves unsupported platforms to the upstream error path', () => {
    const resolvePackage = vi.fn();

    expect(resolveEmbeddedBinaryPaths('win32', 'x64', resolvePackage)).toBeUndefined();
    expect(resolvePackage).not.toHaveBeenCalled();
  });
});
