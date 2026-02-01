/**
 * Document Entity Types
 * Types for markdown/documentation files that follow the "Document AS the Graph" philosophy
 */

// ============================================================================
// Markdown Document Entity
// ============================================================================

/**
 * Represents a markdown document in the codebase.
 * The document itself is a node, with frontmatter stored as a generic property bag.
 */
export interface MarkdownDocumentEntity {
  /** Unique identifier */
  id?: string;
  /** Absolute path to the file */
  path: string;
  /** File name without path */
  name: string;
  /** Document title (first H1 or frontmatter.title) */
  title: string | null;
  /** YAML frontmatter as generic key-value pairs (schema-agnostic) */
  frontmatter: Record<string, unknown>;
  /** Content hash for change detection */
  hash: string;
  /** Last modification timestamp (ISO 8601) */
  lastModified: string;
}

// ============================================================================
// Section Entity
// ============================================================================

/**
 * Represents a section (heading) in a markdown document.
 * Sections form a hierarchy based on heading levels (H1-H6).
 */
export interface SectionEntity {
  /** Unique identifier */
  id?: string;
  /** Heading text content */
  heading: string;
  /** Heading level (1-6) */
  level: number;
  /** Absolute path to the file containing this section */
  filePath: string;
  /** Starting line number (1-indexed) */
  startLine: number;
  /** Ending line number (1-indexed, end of section content) */
  endLine: number;
}

// ============================================================================
// Code Block Entity
// ============================================================================

/**
 * Represents a fenced code block in a markdown document.
 * Code blocks can reference actual code entities for symbol resolution.
 */
export interface CodeBlockEntity {
  /** Unique identifier */
  id?: string;
  /** Language identifier (e.g., 'typescript', 'bash') or null if unspecified */
  language: string | null;
  /** Code content */
  content: string;
  /** Absolute path to the file containing this code block */
  filePath: string;
  /** Starting line number (1-indexed) */
  startLine: number;
  /** Ending line number (1-indexed) */
  endLine: number;
}

// ============================================================================
// Link Entity
// ============================================================================

/**
 * Represents a link in a markdown document.
 * Links create edges between documents and external resources.
 */
export interface LinkEntity {
  /** Unique identifier */
  id?: string;
  /** Link text (anchor text) */
  text: string;
  /** Link target (URL or relative path) */
  target: string;
  /** Whether the link is internal (relative path) or external (absolute URL) */
  isInternal: boolean;
  /** Absolute path to the file containing this link */
  filePath: string;
  /** Line number where the link appears (1-indexed) */
  line: number;
  /** Anchor/fragment if present (e.g., #section-id) */
  anchor?: string;
}

// ============================================================================
// Extracted Document Entities
// ============================================================================

/**
 * All entities extracted from a markdown document in a single pass.
 */
export interface ExtractedDocumentEntities {
  /** The document itself */
  document: MarkdownDocumentEntity;
  /** All sections (headings) */
  sections: SectionEntity[];
  /** All code blocks */
  codeBlocks: CodeBlockEntity[];
  /** All links */
  links: LinkEntity[];
}
