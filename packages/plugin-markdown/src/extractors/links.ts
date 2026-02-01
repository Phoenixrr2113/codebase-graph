/**
 * Link Extractor
 * Extracts internal and external links from markdown AST
 */

import { visit } from 'unist-util-visit';
import type { Root, Link, Text } from 'mdast';
import type { LinkEntity } from '@codegraph/types';

/**
 * Extract text content from a link node.
 */
function getLinkText(node: Link): string {
  const textParts: string[] = [];
  
  for (const child of node.children) {
    if (child.type === 'text') {
      textParts.push((child as Text).value);
    } else if (child.type === 'inlineCode') {
      textParts.push((child as { value: string }).value);
    }
  }
  
  return textParts.join('').trim();
}

/**
 * Check if a URL is internal (relative path) or external (absolute URL).
 */
function isInternalLink(url: string): boolean {
  // External URLs start with http://, https://, or protocol-relative //
  if (/^https?:\/\//i.test(url) || url.startsWith('//')) {
    return false;
  }
  
  // Email links
  if (url.startsWith('mailto:')) {
    return false;
  }
  
  // Anchor-only links are internal
  if (url.startsWith('#')) {
    return true;
  }
  
  // Relative paths are internal
  return true;
}

/**
 * Parse anchor/fragment from a URL.
 * 
 * @param url - Full URL including possible anchor
 * @returns Object with base URL and anchor
 */
function parseAnchor(url: string): { base: string; anchor?: string } {
  const hashIndex = url.indexOf('#');
  if (hashIndex === -1) {
    return { base: url };
  }
  
  return {
    base: url.slice(0, hashIndex),
    anchor: url.slice(hashIndex + 1),
  };
}

/**
 * Extract links from a markdown AST.
 * 
 * Links are categorized as:
 * - Internal: relative paths to other files or anchors
 * - External: absolute URLs to external resources
 * 
 * @param ast - Parsed markdown AST (Root node)
 * @param filePath - Absolute path to the source file
 * @returns Array of link entities
 */
export function extractLinks(ast: Root, filePath: string): LinkEntity[] {
  const links: LinkEntity[] = [];
  
  visit(ast, 'link', (node: Link) => {
    const text = getLinkText(node);
    const { base, anchor } = parseAnchor(node.url);
    
    const link: LinkEntity = {
      text: text || node.url, // Use URL as fallback if no text
      target: base || node.url,
      isInternal: isInternalLink(node.url),
      filePath,
      line: node.position?.start.line ?? 0,
    };
    
    if (anchor) {
      link.anchor = anchor;
    }
    
    links.push(link);
  });
  
  return links;
}

/**
 * Resolve a relative link to an absolute path.
 * 
 * @param link - Link entity with relative target
 * @param basePath - Base directory path
 * @returns Absolute path or null if external
 */
export function resolveLink(
  link: LinkEntity,
  basePath: string
): string | null {
  if (!link.isInternal) {
    return null;
  }
  
  // Handle anchor-only links (same file)
  if (link.target === '' || link.target.startsWith('#')) {
    return link.filePath;
  }
  
  // Resolve relative path
  const { dirname, resolve } = require('path');
  const dir = dirname(link.filePath);
  return resolve(dir, link.target);
}
