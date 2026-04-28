import { authenticate } from './auth.js';
import { retry } from './retry.js';

export async function authenticatedRequest(token: string, fn: () => Promise<Response>): Promise<Response> {
  if (!authenticate(token)) throw new Error('not authenticated');
  return retry(fn);
}
