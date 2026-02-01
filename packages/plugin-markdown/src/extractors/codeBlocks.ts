/**
 * Code Block Extractor
 * Extracts fenced code blocks from markdown AST
 */

import { visit } from 'unist-util-visit';
import type { Root, Code } from 'mdast';
import type { CodeBlockEntity } from '@codegraph/types';

/**
 * Extract code blocks from a markdown AST.
 * 
 * Code blocks include:
 * - Fenced code blocks (```language ... ```)
 * - Indented code blocks (4 spaces)
 * 
 * @param ast - Parsed markdown AST (Root node)
 * @param filePath - Absolute path to the source file
 * @returns Array of code block entities
 */
export function extractCodeBlocks(ast: Root, filePath: string): CodeBlockEntity[] {
  const codeBlocks: CodeBlockEntity[] = [];
  
  visit(ast, 'code', (node: Code) => {
    const codeBlock: CodeBlockEntity = {
      language: node.lang ?? null,
      content: node.value,
      filePath,
      startLine: node.position?.start.line ?? 0,
      endLine: node.position?.end.line ?? 0,
    };
    
    codeBlocks.push(codeBlock);
  });
  
  return codeBlocks;
}

/**
 * Common language aliases for normalization.
 */
const LANGUAGE_ALIASES: Record<string, string> = {
  'js': 'javascript',
  'ts': 'typescript',
  'tsx': 'typescript',
  'jsx': 'javascript',
  'py': 'python',
  'rb': 'ruby',
  'sh': 'bash',
  'shell': 'bash',
  'zsh': 'bash',
  'yml': 'yaml',
  'dockerfile': 'docker',
};

/**
 * Normalize a language identifier.
 * 
 * @param lang - Language identifier from code block
 * @returns Normalized language name
 */
export function normalizeLanguage(lang: string | null): string | null {
  if (!lang) return null;
  const lower = lang.toLowerCase().trim();
  return LANGUAGE_ALIASES[lower] ?? lower;
}

/**
 * Check if a code block contains shell commands.
 * 
 * @param codeBlock - Code block entity
 * @returns true if the code block appears to contain shell commands
 */
export function isShellCommand(codeBlock: CodeBlockEntity): boolean {
  const lang = normalizeLanguage(codeBlock.language);
  if (lang === 'bash' || lang === 'sh') return true;
  
  // Check content for common shell patterns
  const content = codeBlock.content.trim();
  return (
    content.startsWith('$') ||
    content.startsWith('#') ||
    content.includes('npm ') ||
    content.includes('pnpm ') ||
    content.includes('yarn ') ||
    content.includes('bun ') ||
    content.includes('curl ') ||
    content.includes('git ')
  );
}
