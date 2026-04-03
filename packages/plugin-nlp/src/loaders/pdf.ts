/**
 * PDF Loader — extracts text from PDF files using pdf-parse.
 */

import type { TextLoader, LoaderResult } from './index';

export const PDFLoader: TextLoader = {
  extensions: ['pdf'],

  async extract(input: string | Buffer): Promise<LoaderResult> {
    // Dynamic import — pdf-parse is optional
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const pdfParseModule = await import('pdf-parse') as any;
    const pdfParse = pdfParseModule.default ?? pdfParseModule;

    let buffer: Buffer;
    if (typeof input === 'string') {
      const { readFile } = await import('node:fs/promises');
      buffer = await readFile(input);
    } else {
      buffer = input;
    }

    const data = await pdfParse(buffer) as { text: string; numpages: number; info?: Record<string, unknown> };

    const title = data.info?.Title as string | undefined;

    return {
      text: data.text,
      metadata: {
        format: 'pdf',
        pageCount: data.numpages,
        ...(title != null ? { title } : {}),
      },
    };
  },
};
