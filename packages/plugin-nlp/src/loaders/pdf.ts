/**
 * PDF Loader: extracts text from PDF files using pdf-parse.
 */

import type { TextLoader, LoaderResult } from './index';

export const PDFLoader: TextLoader = {
  extensions: ['pdf'],

  async extract(input: string | Buffer): Promise<LoaderResult> {
    let buffer: Buffer;
    if (typeof input === 'string') {
      const { readFile } = await import('node:fs/promises');
      buffer = await readFile(input);
    } else {
      buffer = input;
    }

    const { PDFParse } = await import('pdf-parse');
    const parser = new PDFParse({ data: buffer });

    try {
      const textResult = await parser.getText();
      const infoResult = await parser.getInfo();
      const rawTitle: unknown = infoResult.info?.Title;
      const title = typeof rawTitle === 'string' ? rawTitle : undefined;

      return {
        text: textResult.text,
        metadata: {
          format: 'pdf',
          pageCount: textResult.total,
          ...(title ? { title } : {}),
        },
      };
    } finally {
      await parser.destroy();
    }
  },
};
