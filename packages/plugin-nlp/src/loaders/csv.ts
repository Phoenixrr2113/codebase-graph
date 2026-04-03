/**
 * CSV Loader — converts CSV rows to "key: value" text for knowledge extraction.
 * No external dependencies.
 */

import type { TextLoader, LoaderResult } from './index';

/**
 * Simple CSV parser that handles quoted fields.
 */
function parseCSV(text: string): string[][] {
  const rows: string[][] = [];
  const lines = text.split('\n');

  for (const line of lines) {
    if (!line.trim()) continue;
    const cells: string[] = [];
    let current = '';
    let inQuotes = false;

    for (let i = 0; i < line.length; i++) {
      const char = line[i]!;
      if (char === '"') {
        if (inQuotes && line[i + 1] === '"') {
          current += '"';
          i++; // skip escaped quote
        } else {
          inQuotes = !inQuotes;
        }
      } else if (char === ',' && !inQuotes) {
        cells.push(current.trim());
        current = '';
      } else {
        current += char;
      }
    }
    cells.push(current.trim());
    rows.push(cells);
  }

  return rows;
}

export const CSVLoader: TextLoader = {
  extensions: ['csv', 'tsv'],

  async extract(input: string | Buffer): Promise<LoaderResult> {
    let text: string;
    if (Buffer.isBuffer(input)) {
      text = input.toString('utf-8');
    } else if (typeof input === 'string' && !input.includes(',') && !input.includes('\n')) {
      // Looks like a file path
      const { readFile } = await import('node:fs/promises');
      text = await readFile(input, 'utf-8');
    } else {
      text = input;
    }

    const rows = parseCSV(text);
    if (rows.length === 0) {
      return { text: '', metadata: { format: 'csv', rowCount: 0 } };
    }

    // First row is headers
    const headers = rows[0]!;
    const dataRows = rows.slice(1);

    // Convert each row to "key: value" format for LLM extraction
    const textLines = dataRows.map((row, idx) => {
      const pairs = headers
        .map((header, i) => {
          const value = row[i] ?? '';
          return value ? `${header}: ${value}` : null;
        })
        .filter(Boolean);
      return `Row ${idx + 1}: ${pairs.join(', ')}`;
    });

    return {
      text: textLines.join('\n'),
      metadata: {
        format: 'csv',
        rowCount: dataRows.length,
        columns: headers,
      },
    };
  },
};
