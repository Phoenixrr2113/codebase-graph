/**
 * @codegraph/plugin-markdown
 * Markdown document plugin for CodeGraph
 * 
 * Follows the "Document AS the Graph" philosophy:
 * - Documents and sections are nodes
 * - Links are edges between documents
 * - Code blocks are attached executable content
 * - Frontmatter provides metadata (schema-agnostic)
 */

import { createLogger } from '@codegraph/logger';
import type {
  MarkdownDocumentEntity,
  SectionEntity,
  CodeBlockEntity,
  LinkEntity,
  ExtractedDocumentEntities,
} from '@codegraph/types';

import { parseMarkdown, type ParsedMarkdown } from './parser';
import { extractSections } from './extractors/sections';
import { extractCodeBlocks } from './extractors/codeBlocks';
import { extractLinks } from './extractors/links';
import { createHash } from 'crypto';
import { readFile, stat } from 'node:fs/promises';
import { basename, extname } from 'node:path';

const logger = createLogger({ namespace: 'PluginMarkdown' });

// ============================================================================
// Supported Extensions
// ============================================================================

const SUPPORTED_EXTENSIONS = ['.md', '.mdc', '.mdx'];

/**
 * Check if a file extension is supported by this plugin.
 */
export function isSupported(ext: string): boolean {
  return SUPPORTED_EXTENSIONS.includes(ext.toLowerCase());
}

/**
 * Get all supported file extensions.
 */
export function getSupportedExtensions(): string[] {
  return [...SUPPORTED_EXTENSIONS];
}

// ============================================================================
// Document Parsing
// ============================================================================

/**
 * Extract the document title from frontmatter or first H1 heading.
 */
function extractTitle(
  frontmatter: Record<string, unknown>,
  sections: SectionEntity[]
): string | null {
  // Check frontmatter first
  if (typeof frontmatter.title === 'string') {
    return frontmatter.title;
  }
  if (typeof frontmatter.name === 'string') {
    return frontmatter.name;
  }

  // Fall back to first H1
  const h1 = sections.find(s => s.level === 1);
  return h1?.heading ?? null;
}

/**
 * Generate a content hash for change detection.
 */
function generateHash(content: string): string {
  return createHash('sha256').update(content).digest('hex').slice(0, 16);
}

/**
 * Generate a unique ID for a document entity.
 */
function generateDocumentId(filePath: string): string {
  return `md:${generateHash(filePath)}`;
}

/**
 * Generate a unique ID for a section entity.
 */
function generateSectionId(filePath: string, heading: string, line: number): string {
  return `section:${generateHash(`${filePath}:${heading}:${line}`)}`;
}

/**
 * Generate a unique ID for a code block entity.
 */
function generateCodeBlockId(filePath: string, line: number): string {
  return `codeblock:${generateHash(`${filePath}:${line}`)}`;
}

/**
 * Generate a unique ID for a link entity.
 */
function generateLinkId(filePath: string, target: string, line: number): string {
  return `link:${generateHash(`${filePath}:${target}:${line}`)}`;
}

// ============================================================================
// Main Extraction API
// ============================================================================

/**
 * Parse a markdown file and extract all entities.
 * 
 * @param filePath - Absolute path to the markdown file
 * @returns Extracted document entities
 */
export async function parseMarkdownFile(
  filePath: string
): Promise<ExtractedDocumentEntities> {
  logger.debug(`Parsing markdown file: ${filePath}`);

  // Read file content
  const content = await readFile(filePath, 'utf-8');
  const fileStat = await stat(filePath);

  // Parse markdown content
  const parsed = await parseMarkdown(content);

  // Extract sections (headings)
  const sections = extractSections(parsed.ast, filePath);
  sections.forEach((s, i) => {
    s.id = generateSectionId(filePath, s.heading, s.startLine);
  });

  // Extract code blocks
  const codeBlocks = extractCodeBlocks(parsed.ast, filePath);
  codeBlocks.forEach((cb) => {
    cb.id = generateCodeBlockId(filePath, cb.startLine);
  });

  // Extract links
  const links = extractLinks(parsed.ast, filePath);
  links.forEach((l) => {
    l.id = generateLinkId(filePath, l.target, l.line);
  });

  // Build document entity
  const document: MarkdownDocumentEntity = {
    id: generateDocumentId(filePath),
    path: filePath,
    name: basename(filePath),
    title: extractTitle(parsed.frontmatter, sections),
    frontmatter: parsed.frontmatter,
    hash: generateHash(content),
    lastModified: fileStat.mtime.toISOString(),
  };

  logger.info(
    `Extracted from ${basename(filePath)}: ${sections.length} sections, ` +
    `${codeBlocks.length} code blocks, ${links.length} links`
  );

  return {
    document,
    sections,
    codeBlocks,
    links,
  };
}

/**
 * Parse markdown content directly (without file I/O).
 * Useful for testing or processing content from other sources.
 * 
 * @param content - Markdown content string
 * @param filePath - Virtual file path for entity references
 * @returns Extracted document entities
 */
export async function parseMarkdownContent(
  content: string,
  filePath: string
): Promise<ExtractedDocumentEntities> {
  const parsed = await parseMarkdown(content);

  const sections = extractSections(parsed.ast, filePath);
  sections.forEach((s) => {
    s.id = generateSectionId(filePath, s.heading, s.startLine);
  });

  const codeBlocks = extractCodeBlocks(parsed.ast, filePath);
  codeBlocks.forEach((cb) => {
    cb.id = generateCodeBlockId(filePath, cb.startLine);
  });

  const links = extractLinks(parsed.ast, filePath);
  links.forEach((l) => {
    l.id = generateLinkId(filePath, l.target, l.line);
  });

  const document: MarkdownDocumentEntity = {
    id: generateDocumentId(filePath),
    path: filePath,
    name: basename(filePath),
    title: extractTitle(parsed.frontmatter, sections),
    frontmatter: parsed.frontmatter,
    hash: generateHash(content),
    lastModified: new Date().toISOString(),
  };

  return {
    document,
    sections,
    codeBlocks,
    links,
  };
}

// ============================================================================
// Re-exports
// ============================================================================

export { parseMarkdown, type ParsedMarkdown } from './parser';
export { extractSections } from './extractors/sections';
export { extractCodeBlocks } from './extractors/codeBlocks';
export { extractLinks } from './extractors/links';
