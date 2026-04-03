/**
 * Loader Registry — maps file extensions to loaders.
 */

import type { TextLoader } from './index';
import { PDFLoader } from './pdf';
import { DOCXLoader } from './docx';
import { HTMLLoader } from './html';
import { CSVLoader } from './csv';

const loaders: Map<string, TextLoader> = new Map();

/** Register a loader for its declared extensions */
export function registerLoader(loader: TextLoader): void {
  for (const ext of loader.extensions) {
    loaders.set(ext.toLowerCase(), loader);
  }
}

/** Get a loader for a file extension (without dot) */
export function getLoaderForExtension(ext: string): TextLoader | undefined {
  return loaders.get(ext.toLowerCase().replace(/^\./, ''));
}

/** Get all supported file extensions */
export function getSupportedExtensions(): string[] {
  return [...loaders.keys()];
}

// Register built-in loaders
registerLoader(PDFLoader);
registerLoader(DOCXLoader);
registerLoader(HTMLLoader);
registerLoader(CSVLoader);
