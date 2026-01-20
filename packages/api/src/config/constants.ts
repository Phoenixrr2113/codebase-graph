/**
 * Shared constants for the API package
 * Centralized configuration to avoid duplication across services
 */

/** Supported file extensions for parsing */
export const SUPPORTED_EXTENSIONS: readonly string[] = [
  // TypeScript/JavaScript
  '.ts', '.tsx', '.js', '.jsx', '.mts', '.cts', '.mjs', '.cjs',
  // Python
  '.py', '.pyw', '.pyi',
  // C#
  '.cs',
];

/** Python file extensions */
export const PYTHON_EXTENSIONS: readonly string[] = ['.py', '.pyw', '.pyi'];

/** C# file extensions */
export const CSHARP_EXTENSIONS: readonly string[] = ['.cs'];

/** Default glob patterns to ignore during parsing and watching */
export const DEFAULT_IGNORE_PATTERNS: readonly string[] = [
  '**/node_modules/**',
  '**/dist/**',
  '**/build/**',
  '**/.git/**',
  '**/coverage/**',
  '**/*.test.ts',
  '**/*.test.tsx',
  '**/*.spec.ts',
  '**/*.spec.tsx',
  '**/__tests__/**',
  '**/__mocks__/**',
  '**/.next/**',
  '**/.turbo/**',
  '**/__pycache__/**',
  '**/.venv/**',
  '**/venv/**',
  '**/*.pyc',
];

