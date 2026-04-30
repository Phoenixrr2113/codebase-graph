// Stub for the zod-style-factory.ts namespace import resolution test.
// The fixture uses `import * as util from './util.js'` and the imports
// extractor swaps `.js` -> `.ts` to find this file. Without this file present
// `resolvedPath` would be undefined and the namespace-resolution code path
// would short-circuit at the import-map check.

export function floatSafeRemainder(a: number, b: number): number {
  return a - Math.floor(a / b) * b;
}
