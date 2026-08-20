/**
 * Embedded driver lifecycle: shutdown ownership and the startup budget.
 *
 * connect() removes the wrapper's SIGINT/SIGTERM handlers so they cannot stop
 * Redis before our client disconnects. That is only safe if we put our own
 * handlers in their place, because a process killed by a signal never runs its
 * 'exit' handlers, and the spawned redis-server would outlive us.
 */

import { describe, it, expect } from 'vitest';
import { resolveStartupTimeout } from '../drivers/falkordblite';
import { embeddedConnectionHint } from '../client';

describe('resolveStartupTimeout', () => {
  const noSnapshot = (): number | undefined => undefined;
  const snapshotOf = (bytes: number) => (): number => bytes;

  it('uses the floor when there is no snapshot to load', () => {
    expect(resolveStartupTimeout('/data', {}, noSnapshot)).toBe(30_000);
  });

  it('grows with snapshot size', () => {
    const small = resolveStartupTimeout('/data', {}, snapshotOf(5 * 1024 * 1024));
    const large = resolveStartupTimeout('/data', {}, snapshotOf(200 * 1024 * 1024));
    expect(large).toBeGreaterThan(small);
  });

  it('allows well over the 18.7s a 52MB snapshot actually took', () => {
    const budget = resolveStartupTimeout('/data', {}, snapshotOf(52 * 1024 * 1024));
    expect(budget).toBeGreaterThan(18_700);
  });

  it('caps the budget so a broken start still fails in reasonable time', () => {
    const budget = resolveStartupTimeout('/data', {}, snapshotOf(10_000 * 1024 * 1024));
    expect(budget).toBe(300_000);
  });

  it('honours an explicit override', () => {
    const budget = resolveStartupTimeout(
      '/data',
      { CODEGRAPH_DB_STARTUP_TIMEOUT_MS: '90000' },
      snapshotOf(5 * 1024 * 1024),
    );
    expect(budget).toBe(90_000);
  });

  it('ignores an unusable override rather than starting with no budget', () => {
    for (const value of ['0', '-1', 'soon', '']) {
      const budget = resolveStartupTimeout(
        '/data',
        { CODEGRAPH_DB_STARTUP_TIMEOUT_MS: value },
        noSnapshot,
      );
      expect(budget).toBe(30_000);
    }
  });
});

describe('embeddedConnectionHint', () => {
  it('points at the startup budget when the server ran out of time', () => {
    const hint = embeddedConnectionHint('redis-server did not become ready within 10000ms');
    expect(hint).toContain('CODEGRAPH_DB_STARTUP_TIMEOUT_MS');
    expect(hint).not.toContain('pnpm add falkordblite');
  });

  it('still suggests installing when the package is the problem', () => {
    const hint = embeddedConnectionHint("Cannot find module 'falkordblite'");
    expect(hint).toContain('pnpm add falkordblite');
  });
});
