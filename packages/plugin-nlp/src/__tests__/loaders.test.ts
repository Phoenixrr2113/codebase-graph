/**
 * File-to-Text Loaders: Unit Tests
 *
 * Registry: extension lookup, case-insensitive, unsupported types.
 * CSV: key-value conversion, quoted fields, empty file.
 * HTML: body text extraction, nav/footer/script removal, title capture.
 * PDF: real one-page fixture. DOCX remains covered by integration smoke tests.
 */

import { describe, it, expect } from 'vitest';
import { getLoaderForExtension } from '../loaders/registry';
import { CSVLoader } from '../loaders/csv';
import { HTMLLoader } from '../loaders/html';
import { PDFLoader } from '../loaders/pdf';

const PDF_FIXTURE_BASE64 = 'JVBERi0xLjQKMSAwIG9iago8PCAvVHlwZSAvQ2F0YWxvZyAvUGFnZXMgMiAwIFIgPj4KZW5kb2JqCjIgMCBvYmoKPDwgL1R5cGUgL1BhZ2VzIC9LaWRzIFszIDAgUl0gL0NvdW50IDEgPj4KZW5kb2JqCjMgMCBvYmoKPDwgL1R5cGUgL1BhZ2UgL1BhcmVudCAyIDAgUiAvTWVkaWFCb3ggWzAgMCA2MTIgNzkyXSAvUmVzb3VyY2VzIDw8IC9Gb250IDw8IC9GMSA0IDAgUiA+PiA+PiAvQ29udGVudHMgNSAwIFIgPj4KZW5kb2JqCjQgMCBvYmoKPDwgL1R5cGUgL0ZvbnQgL1N1YnR5cGUgL1R5cGUxIC9CYXNlRm9udCAvSGVsdmV0aWNhID4+CmVuZG9iago1IDAgb2JqCjw8IC9MZW5ndGggNTMgPj4Kc3RyZWFtCkJUIC9GMSAxOCBUZiA3MiA3MjAgVGQgKENvZGVHcmFwaCBQREYgZml4dHVyZSkgVGogRVQKZW5kc3RyZWFtCmVuZG9iagp4cmVmCjAgNgowMDAwMDAwMDAwIDY1NTM1IGYgCjAwMDAwMDAwMDkgMDAwMDAgbiAKMDAwMDAwMDA1OCAwMDAwMCBuIAowMDAwMDAwMTE1IDAwMDAwIG4gCjAwMDAwMDAyNDEgMDAwMDAgbiAKMDAwMDAwMDMxMSAwMDAwMCBuIAp0cmFpbGVyCjw8IC9TaXplIDYgL1Jvb3QgMSAwIFIgPj4Kc3RhcnR4cmVmCjQxMwolJUVPRgo=';

// ============================================================================
// Registry
// ============================================================================

describe('loader registry', () => {
  it('returns a loader for .pdf extension', () => {
    const loader = getLoaderForExtension('.pdf');
    expect(loader).toBeDefined();
    expect(loader?.extensions).toContain('pdf');
  });

  it('returns a loader for .docx extension', () => {
    const loader = getLoaderForExtension('.docx');
    expect(loader).toBeDefined();
    expect(loader?.extensions).toContain('docx');
  });

  it('returns a loader for .html extension', () => {
    const loader = getLoaderForExtension('.html');
    expect(loader).toBeDefined();
    expect(loader?.extensions).toContain('html');
  });

  it('returns a loader for .csv extension', () => {
    const loader = getLoaderForExtension('.csv');
    expect(loader).toBeDefined();
    expect(loader?.extensions).toContain('csv');
  });

  it('returns undefined for unsupported extensions', () => {
    expect(getLoaderForExtension('.xyz')).toBeUndefined();
    expect(getLoaderForExtension('.mp3')).toBeUndefined();
  });

  it('is case-insensitive for extension lookup', () => {
    expect(getLoaderForExtension('.PDF')).toBeDefined();
    expect(getLoaderForExtension('.HTML')).toBeDefined();
    expect(getLoaderForExtension('.CSV')).toBeDefined();
  });
});

// ============================================================================
// CSV Loader
// ============================================================================

describe('csv loader', () => {
  it('converts rows to key: value format', async () => {
    const csv = 'name,age\nAlice,30\nBob,25';
    const r = await CSVLoader.extract(csv);
    expect(r.metadata.format).toBe('csv');
    expect(r.metadata.rowCount).toBe(2);
    expect(r.text).toContain('name: Alice');
    expect(r.text).toContain('age: 30');
    expect(r.text).toContain('name: Bob');
    expect(r.text).toContain('age: 25');
  });

  it('handles quoted fields containing commas', async () => {
    const csv = 'name,bio\n"Smith, John","Lives in NYC, NY"';
    const r = await CSVLoader.extract(csv);
    expect(r.text).toContain('name: Smith, John');
    expect(r.text).toContain('bio: Lives in NYC, NY');
  });

  it('handles empty file (as Buffer)', async () => {
    // The CSV loader treats a bare string without comma/newline as a file path.
    // Pass an empty Buffer to test the empty-content branch.
    const r = await CSVLoader.extract(Buffer.from(''));
    expect(r.text).toBe('');
    expect(r.metadata.rowCount).toBe(0);
  });

  it('returns metadata with rowCount and columns', async () => {
    const csv = 'a,b,c\n1,2,3\n4,5,6';
    const r = await CSVLoader.extract(csv);
    expect(r.metadata.rowCount).toBe(2);
    expect(r.metadata.columns).toEqual(['a', 'b', 'c']);
  });
});

// ============================================================================
// HTML Loader
// ============================================================================

describe('html loader', () => {
  it('extracts body text and strips nav/footer/script', async () => {
    // Must start with '<' for the loader to detect it as inline HTML (not a file path)
    const html = `<html><head><title>Test Page</title></head>
      <body>
        <nav>SITE NAV</nav>
        <main>Hello world. Important content here.</main>
        <script>console.log('x')</script>
        <footer>FOOTER CONTENT</footer>
      </body></html>`;
    const r = await HTMLLoader.extract(html);
    expect(r.text).toContain('Hello world');
    expect(r.text).not.toContain('SITE NAV');
    expect(r.text).not.toContain('FOOTER CONTENT');
    expect(r.text).not.toContain("console.log");
    expect(r.metadata.title).toBe('Test Page');
    expect(r.metadata.format).toBe('html');
  });

  it('extracts title from <title> tag', async () => {
    const html = '<html><head><title>My Title</title></head><body><p>content</p></body></html>';
    const r = await HTMLLoader.extract(html);
    expect(r.metadata.title).toBe('My Title');
  });

  it('handles HTML with no body gracefully', async () => {
    const html = '<html><head><title>Empty</title></head></html>';
    const r = await HTMLLoader.extract(html);
    expect(r.text).toBeDefined();
    expect(r.metadata.format).toBe('html');
  });

  it('strips style tags and their contents', async () => {
    const html = '<html><body><style>.foo { color: red; }</style><p>Real content</p></body></html>';
    const r = await HTMLLoader.extract(html);
    expect(r.text).not.toContain('.foo');
    expect(r.text).not.toContain('color: red');
    expect(r.text).toContain('Real content');
  });
});

// ============================================================================
// PDF + DOCX
// ============================================================================

describe('pdf loader', () => {
  it('extracts text and page metadata from a one-page PDF', async () => {
    const pdfBuffer = Buffer.from(PDF_FIXTURE_BASE64, 'base64');

    const result = await PDFLoader.extract(pdfBuffer);

    expect(result.text).toContain('CodeGraph PDF fixture');
    expect(result.metadata.format).toBe('pdf');
    expect(result.metadata.pageCount).toBe(1);
  });
});

describe.skip('docx loader (integration)', () => {
  it('extracts text from a DOCX file', async () => {
    // Requires fixture file: test deferred to Task 5 integration smoke test
  });
});
