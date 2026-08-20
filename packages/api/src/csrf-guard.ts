/**
 * Guard against cross-site forgery on any request that can change state.
 *
 * CORS only decides whether a browser is allowed to READ a response, not
 * whether the request is allowed to run. A "simple" cross-origin request (one
 * a browser sends without a preflight OPTIONS check) still reaches the
 * server and still executes: the server has no CORS say in the matter until
 * it's time to hand back the response, and by then the side effect already
 * landed. Hono's body parser accepts `text/plain`, and `text/plain` is one of
 * the content types a simple request is allowed to carry, so a plain HTML
 * form (or an unadorned `fetch`) on any origin can hit a mutating route on
 * this API and the mutation happens even though the attacker's page never
 * gets to see the reply.
 *
 * The guard keys off the HTTP method, not a list of known routes. GET, HEAD
 * and OPTIONS are read-only by convention and pass through untouched; every
 * other method is treated as capable of changing state and gets checked,
 * whether or not the route existed when this file was written. A hardcoded
 * route allowlist fails open: it protects exactly the routes someone
 * remembered to add to the list, and a new mutating route added later ships
 * unguarded until someone notices and updates this file too. Keying off the
 * method instead means a route is covered the moment it's given a mutating
 * verb, with no second step to forget.
 *
 * Requiring `Content-Type: application/json` closes the preflight gap:
 * browsers will not attach that content type to a simple request, so setting
 * it forces a CORS preflight, and the preflight is where the existing origin
 * allowlist gets to say no. Checking `Origin` directly, when the header is
 * present, is a second and cheap layer against clients that do send JSON
 * cross-origin (an extension, a misconfigured tool) without an intervening
 * preflight.
 *
 * This is not authentication. It does not stop a request issued from the
 * local machine itself (curl, another local process) since that is normal
 * use of a localhost developer tool. It stops a browser tab on some other
 * site from silently driving this API on the user's behalf.
 */

/** Methods that never change state by HTTP convention, so they pass through untouched. */
const SAFE_METHODS: ReadonlySet<string> = new Set(['GET', 'HEAD', 'OPTIONS']);

/** True for any method that can carry a side effect (POST, PUT, PATCH, DELETE, ...). */
export function isMutatingMethod(method: string): boolean {
  return !SAFE_METHODS.has(method.toUpperCase());
}

export interface CsrfDecision {
  ok: boolean;
  status?: 400 | 403;
  message?: string;
}

/**
 * Decide whether a request that can mutate state may proceed.
 *
 * Pure function so the decision logic can be unit tested without spinning up
 * Hono or a network socket; the middleware in index.ts is the thin part that
 * reads headers off the real request and calls this. Deliberately takes no
 * `pathname`: gating on the route is exactly the shape this replaced, since
 * it requires every future mutating route to know it needs to be added to a
 * list somewhere else. Every route gets the same check.
 */
export function checkMutatingRequest(params: {
  method: string;
  contentType: string | null;
  origin: string | null;
  isAllowedOrigin: (origin: string) => boolean;
}): CsrfDecision {
  const { method, contentType, origin, isAllowedOrigin } = params;

  if (!isMutatingMethod(method)) {
    return { ok: true };
  }

  // A same-origin request, or a non-browser client such as curl, may not send
  // an Origin header at all. Only reject when one is present and it fails
  // the same allowlist CORS already enforces.
  if (origin !== null && !isAllowedOrigin(origin)) {
    return {
      ok: false,
      status: 403,
      message: `Origin "${origin}" is not permitted to call this endpoint.`,
    };
  }

  const mimeType = contentType?.split(';')[0]?.trim().toLowerCase() ?? null;
  if (mimeType !== 'application/json') {
    return {
      ok: false,
      status: 400,
      message: 'This endpoint requires "Content-Type: application/json".',
    };
  }

  return { ok: true };
}
