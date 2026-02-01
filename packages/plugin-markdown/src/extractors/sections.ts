/**
 * Section Extractor
 * Extracts heading hierarchy from markdown AST
 */

import { visit } from 'unist-util-visit';
import type { Root, Heading, Text, InlineCode } from 'mdast';
import type { SectionEntity } from '@codegraph/types';

/**
 * Extract text content from a heading node.
 * Handles nested text nodes, inline code, etc.
 */
function getHeadingText(node: Heading): string {
  const textParts: string[] = [];
  
  for (const child of node.children) {
    if (child.type === 'text') {
      textParts.push((child as Text).value);
    } else if (child.type === 'inlineCode') {
      textParts.push((child as InlineCode).value);
    } else if ('children' in child && Array.isArray(child.children)) {
      // Recursively extract text from nested nodes
      for (const grandchild of child.children) {
        if (grandchild.type === 'text') {
          textParts.push((grandchild as Text).value);
        }
      }
    }
  }
  
  return textParts.join('').trim();
}

/**
 * Extract sections (headings) from a markdown AST.
 * 
 * Sections form a hierarchy based on heading levels (H1-H6).
 * The parent-child relationships are determined by the heading levels:
 * - An H2 under an H1 is a child of that H1
 * - An H3 under an H2 is a child of that H2
 * - etc.
 * 
 * @param ast - Parsed markdown AST (Root node)
 * @param filePath - Absolute path to the source file
 * @returns Array of section entities
 */
export function extractSections(ast: Root, filePath: string): SectionEntity[] {
  const sections: SectionEntity[] = [];
  
  visit(ast, 'heading', (node: Heading) => {
    const heading = getHeadingText(node);
    
    if (!heading) {
      return; // Skip empty headings
    }
    
    const section: SectionEntity = {
      heading,
      level: node.depth,
      filePath,
      startLine: node.position?.start.line ?? 0,
      endLine: node.position?.end.line ?? 0,
    };
    
    sections.push(section);
  });
  
  // Calculate section end lines based on next section or EOF
  // Each section extends until the next section of equal or higher level
  for (let i = 0; i < sections.length; i++) {
    const current = sections[i];
    let endLine = current.startLine; // Default to just the heading line
    
    // Find the next section that ends this one
    for (let j = i + 1; j < sections.length; j++) {
      const next = sections[j];
      if (next.level <= current.level) {
        // Next section is same or higher level, this section ends before it
        endLine = next.startLine - 1;
        break;
      }
    }
    
    // If we didn't find a terminating section, extend to end of file
    // We'll use the last position in the AST
    if (endLine === current.startLine && ast.position?.end.line) {
      endLine = ast.position.end.line;
    }
    
    current.endLine = endLine;
  }
  
  return sections;
}

/**
 * Build section hierarchy edges.
 * Returns pairs of [parentId, childId] for PARENT_SECTION edges.
 * 
 * @param sections - Extracted sections with IDs
 * @returns Array of [parentId, childId] tuples
 */
export function buildSectionHierarchy(
  sections: SectionEntity[]
): Array<[string, string]> {
  const edges: Array<[string, string]> = [];
  const stack: SectionEntity[] = [];
  
  for (const section of sections) {
    // Pop sections from stack that are not parents of this section
    while (stack.length > 0 && stack[stack.length - 1].level >= section.level) {
      stack.pop();
    }
    
    // If there's a parent on the stack, create an edge
    if (stack.length > 0 && section.id && stack[stack.length - 1].id) {
      edges.push([stack[stack.length - 1].id!, section.id]);
    }
    
    // Push this section onto the stack
    stack.push(section);
  }
  
  return edges;
}
