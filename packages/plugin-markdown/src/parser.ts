/**
 * Markdown Parser
 * Uses unified/remark to parse markdown into an AST
 */

import { unified } from 'unified';
import remarkParse from 'remark-parse';
import remarkFrontmatter from 'remark-frontmatter';
import remarkGfm from 'remark-gfm';
import matter from 'gray-matter';
import type { Root } from 'mdast';

// ============================================================================
// Types
// ============================================================================

/**
 * Result of parsing a markdown document.
 */
export interface ParsedMarkdown {
  /** Extracted YAML frontmatter as key-value pairs */
  frontmatter: Record<string, unknown>;
  /** Markdown AST (mdast Root node) */
  ast: Root;
  /** Markdown content without frontmatter */
  content: string;
}

// ============================================================================
// Parser
// ============================================================================

/**
 * Parse markdown content into an AST with frontmatter extraction.
 * 
 * Uses:
 * - gray-matter for frontmatter extraction (handles YAML, TOML, JSON)
 * - unified/remark for markdown AST parsing
 * - remark-gfm for GitHub Flavored Markdown support
 * 
 * @param rawContent - Raw markdown content including frontmatter
 * @returns Parsed markdown with AST and frontmatter
 */
export async function parseMarkdown(rawContent: string): Promise<ParsedMarkdown> {
  // Extract frontmatter using gray-matter
  const { data: frontmatter, content } = matter(rawContent);
  
  // Create the unified processor with markdown plugins
  const processor = unified()
    .use(remarkParse)
    .use(remarkFrontmatter, ['yaml', 'toml'])  // Support YAML and TOML frontmatter
    .use(remarkGfm);  // Support tables, strikethrough, task lists, etc.
  
  // Parse the markdown content (without frontmatter)
  const ast = processor.parse(content) as Root;
  
  return {
    frontmatter: frontmatter as Record<string, unknown>,
    ast,
    content,
  };
}
