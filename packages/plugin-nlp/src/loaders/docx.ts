/**
 * DOCX Loader — extracts text from Word documents using mammoth.
 */

import type { TextLoader, LoaderResult } from './index';

export const DOCXLoader: TextLoader = {
  extensions: ['docx'],

  async extract(input: string | Buffer): Promise<LoaderResult> {
    const mammoth = await import('mammoth');

    let buffer: Buffer;
    if (typeof input === 'string') {
      const { readFile } = await import('node:fs/promises');
      buffer = await readFile(input);
    } else {
      buffer = input;
    }

    const result = await mammoth.extractRawText({ buffer });

    return {
      text: result.value,
      metadata: {
        format: 'docx',
      },
    };
  },
};
