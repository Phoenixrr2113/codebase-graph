/**
 * Base URL for the CodeGraph API.
 *
 * The dashboard is normally served by the API process itself, so requests are
 * same origin and an empty base yields relative URLs. That removes the need for
 * any CORS allowance in the shipped configuration. During `vite dev` the UI runs
 * on its own port, so fall back to the default API port. Override with
 * VITE_API_URL when the API lives somewhere else.
 */
const configured = import.meta.env.VITE_API_URL as string | undefined;

export const API_URL: string =
  configured !== undefined && configured !== ''
    ? configured.replace(/\/+$/, '')
    : import.meta.env.DEV
      ? 'http://localhost:3001'
      : '';
