/**
 * File-to-Text Loaders
 *
 * Convert various file formats to plain text for knowledge extraction.
 * Each loader implements the TextLoader interface.
 */

export interface LoaderResult {
  /** Extracted text content */
  text: string;
  /** Format-specific metadata */
  metadata: {
    title?: string;
    pageCount?: number;
    format: string;
    [key: string]: unknown;
  };
}

export interface TextLoader {
  /** File extensions this loader handles (without dot) */
  extensions: string[];
  /** Extract text from file content */
  extract(input: string | Buffer): Promise<LoaderResult>;
}

export { PDFLoader } from './pdf';
export { DOCXLoader } from './docx';
export { HTMLLoader } from './html';
export { CSVLoader } from './csv';
export { getLoaderForExtension, registerLoader, getSupportedExtensions } from './registry';
