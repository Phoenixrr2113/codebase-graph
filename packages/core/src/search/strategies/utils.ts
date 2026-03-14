/**
 * Shared utilities for search strategies
 */

import { NoObjectGeneratedError, NoOutputGeneratedError } from 'ai';

/** Check if an error is a structured output generation failure */
export function isNoOutputError(error: unknown): boolean {
  return NoOutputGeneratedError.isInstance(error) || NoObjectGeneratedError.isInstance(error);
}
