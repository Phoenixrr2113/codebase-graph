/**
 * HTML Loader — extracts main text content from HTML, stripping nav/footer/scripts.
 * Also handles URL fetching for web page ingestion.
 */

import type { TextLoader, LoaderResult } from './index';

export const HTMLLoader: TextLoader = {
  extensions: ['html', 'htm'],

  async extract(input: string | Buffer): Promise<LoaderResult> {
    const cheerio = await import('cheerio');

    let html: string;
    if (Buffer.isBuffer(input)) {
      html = input.toString('utf-8');
    } else if (input.startsWith('http://') || input.startsWith('https://')) {
      // URL — fetch the page
      const response = await fetch(input);
      if (!response.ok) {
        throw new Error(`Failed to fetch URL: ${response.status} ${response.statusText}`);
      }
      html = await response.text();
    } else if (input.startsWith('<') || input.includes('<!DOCTYPE')) {
      // Raw HTML string
      html = input;
    } else {
      // File path
      const { readFile } = await import('node:fs/promises');
      html = await readFile(input, 'utf-8');
    }

    const $ = cheerio.load(html);

    // Remove non-content elements
    $('script, style, nav, footer, header, aside, iframe, noscript, [role="navigation"], [role="banner"], [role="contentinfo"]').remove();

    // Extract title
    const title = $('title').text().trim() || $('h1').first().text().trim() || undefined;

    // Try to get main content area first, fall back to body
    let text = '';
    const mainContent = $('main, article, [role="main"], .content, #content').first();
    if (mainContent.length > 0) {
      text = mainContent.text();
    } else {
      text = $('body').text();
    }

    // Clean up whitespace
    text = text
      .replace(/\s+/g, ' ')
      .replace(/\n\s*\n/g, '\n\n')
      .trim();

    return {
      text,
      metadata: {
        format: 'html',
        ...(title != null ? { title } : {}),
      },
    };
  },
};
