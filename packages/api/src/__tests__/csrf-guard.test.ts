/**
 * CORS only decides whether a browser may read a response, not whether a
 * cross-origin request runs at all. A simple cross-site POST (text/plain
 * body, no preflight) still reaches the server and still executes; the
 * mutation lands even though the attacker's page never sees the reply. These
 * tests pin the guard that closes that gap.
 *
 * The guard is method-based rather than a hardcoded list of routes: GET,
 * HEAD and OPTIONS pass through untouched, and every other method is
 * checked, regardless of which route it hits. That is the point of several
 * cases below, since a route allowlist would have quietly waved through
 * exactly the requests these are meant to catch.
 */

import { describe, it, expect } from 'vitest';
import { checkMutatingRequest, isMutatingMethod } from '../csrf-guard';

const ALLOW_ALL = () => true;
const ALLOW_NONE = () => false;

describe('isMutatingMethod', () => {
  it('treats GET, HEAD and OPTIONS as safe', () => {
    expect(isMutatingMethod('GET')).toBe(false);
    expect(isMutatingMethod('HEAD')).toBe(false);
    expect(isMutatingMethod('OPTIONS')).toBe(false);
  });

  it('treats POST, PUT, PATCH and DELETE as mutating', () => {
    expect(isMutatingMethod('POST')).toBe(true);
    expect(isMutatingMethod('PUT')).toBe(true);
    expect(isMutatingMethod('PATCH')).toBe(true);
    expect(isMutatingMethod('DELETE')).toBe(true);
  });

  it('is case-insensitive', () => {
    expect(isMutatingMethod('get')).toBe(false);
    expect(isMutatingMethod('post')).toBe(true);
  });
});

describe('checkMutatingRequest', () => {
  it('passes GET requests through untouched, even with a hostile origin and content type', () => {
    const decision = checkMutatingRequest({
      method: 'GET',
      contentType: 'text/plain',
      origin: 'https://evil.example.com',
      isAllowedOrigin: ALLOW_NONE,
    });
    expect(decision).toEqual({ ok: true });
  });

  it('passes HEAD and OPTIONS through untouched as well', () => {
    for (const method of ['HEAD', 'OPTIONS']) {
      const decision = checkMutatingRequest({
        method,
        contentType: 'text/plain',
        origin: 'https://evil.example.com',
        isAllowedOrigin: ALLOW_NONE,
      });
      expect(decision).toEqual({ ok: true });
    }
  });

  it('rejects a text/plain POST (the forgeable case)', () => {
    const decision = checkMutatingRequest({
      method: 'POST',
      contentType: 'text/plain',
      origin: null,
      isAllowedOrigin: ALLOW_ALL,
    });
    expect(decision).toMatchObject({ ok: false, status: 400 });
  });

  it('rejects a POST with no Content-Type at all', () => {
    const decision = checkMutatingRequest({
      method: 'POST',
      contentType: null,
      origin: null,
      isAllowedOrigin: ALLOW_ALL,
    });
    expect(decision).toMatchObject({ ok: false, status: 400 });
  });

  it('accepts application/json with no Origin header (curl, same-origin fetch)', () => {
    const decision = checkMutatingRequest({
      method: 'POST',
      contentType: 'application/json',
      origin: null,
      isAllowedOrigin: ALLOW_NONE,
    });
    expect(decision).toEqual({ ok: true });
  });

  it('accepts application/json with a charset parameter', () => {
    const decision = checkMutatingRequest({
      method: 'POST',
      contentType: 'application/json; charset=utf-8',
      origin: null,
      isAllowedOrigin: ALLOW_NONE,
    });
    expect(decision).toEqual({ ok: true });
  });

  it('accepts application/json from an allowed Origin', () => {
    const decision = checkMutatingRequest({
      method: 'POST',
      contentType: 'application/json',
      origin: 'http://localhost:3000',
      isAllowedOrigin: ALLOW_ALL,
    });
    expect(decision).toEqual({ ok: true });
  });

  it('rejects application/json from a disallowed Origin', () => {
    const decision = checkMutatingRequest({
      method: 'POST',
      contentType: 'application/json',
      origin: 'https://evil.example.com',
      isAllowedOrigin: ALLOW_NONE,
    });
    expect(decision).toMatchObject({ ok: false, status: 403 });
  });

  it('checks Origin before Content-Type, so a disallowed origin is rejected either way', () => {
    const decision = checkMutatingRequest({
      method: 'POST',
      contentType: 'text/plain',
      origin: 'https://evil.example.com',
      isAllowedOrigin: ALLOW_NONE,
    });
    expect(decision).toMatchObject({ ok: false, status: 403 });
  });

  it('does not leak the request body or query text in the rejection message', () => {
    const decision = checkMutatingRequest({
      method: 'POST',
      contentType: 'text/plain',
      origin: null,
      isAllowedOrigin: ALLOW_ALL,
    });
    expect(decision.message).not.toContain('MATCH');
    expect(decision.message).not.toContain('CREATE');
  });

  it('rejects a text/plain DELETE, a mutating method other than POST', () => {
    const decision = checkMutatingRequest({
      method: 'DELETE',
      contentType: 'text/plain',
      origin: null,
      isAllowedOrigin: ALLOW_ALL,
    });
    expect(decision).toMatchObject({ ok: false, status: 400 });
  });

  it('accepts a properly formed PUT from an allowed origin, same as POST', () => {
    const decision = checkMutatingRequest({
      method: 'PUT',
      contentType: 'application/json',
      origin: 'http://localhost:3000',
      isAllowedOrigin: ALLOW_ALL,
    });
    expect(decision).toEqual({ ok: true });
  });

  it('rejects a text/plain POST that a hardcoded route allowlist would have missed', () => {
    // A route-keyed guard only protects routes someone remembered to list.
    // Imagine `/api/projects/delete` shipping after this file was written:
    // under the old STATE_CHANGING_ROUTES allowlist this pathname would not
    // have been recognized and the request would have sailed through as
    // `{ ok: true }`. The method-based guard has no such list, so the exact
    // same request is refused with no route-specific setup required.
    const decision = checkMutatingRequest({
      method: 'POST',
      contentType: 'text/plain',
      origin: null,
      isAllowedOrigin: ALLOW_ALL,
    });
    expect(decision).toMatchObject({ ok: false, status: 400 });
  });
});
