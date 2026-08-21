/**
 * Language Plugin Types
 * Defines the interface for language-specific parsing plugins
 */

import type {
  FunctionEntity,
  ClassEntity,
  InterfaceEntity,
  VariableEntity,
  ImportEntity,
  TypeEntity,
  ComponentEntity,
} from './nodes';
import type {
  HasMethodEdgeDescriptor,
  HasPropertyEdgeDescriptor,
  HasParamEdgeDescriptor,
  ReturnsEdgeDescriptor,
  UsesTypeEdgeDescriptor,
} from './edges';
import type { TypeRefEntity } from './nodes';

// ============================================================================
// Tree-sitter Types (generic to avoid direct dependency)
// ============================================================================

/**
 * Generic syntax node interface matching tree-sitter's SyntaxNode
 * This allows plugins to work with tree-sitter without types package depending on it
 */
export interface SyntaxNode {
  type: string;
  text: string;
  startPosition: { row: number; column: number };
  endPosition: { row: number; column: number };
  startIndex: number;
  endIndex: number;
  parent: SyntaxNode | null;
  children: SyntaxNode[];
  namedChildren: SyntaxNode[];
  childCount: number;
  namedChildCount: number;
  firstChild: SyntaxNode | null;
  lastChild: SyntaxNode | null;
  firstNamedChild: SyntaxNode | null;
  lastNamedChild: SyntaxNode | null;
  nextSibling: SyntaxNode | null;
  previousSibling: SyntaxNode | null;
  nextNamedSibling: SyntaxNode | null;
  previousNamedSibling: SyntaxNode | null;
  childForFieldName(fieldName: string): SyntaxNode | null;
  descendantsOfType(type: string | string[]): SyntaxNode[];
}

// ============================================================================
// Entity Extraction Types
// ============================================================================

/** Extracted entities from a single file */
export interface ExtractedEntities {
  imports: ImportEntity[];
  functions: FunctionEntity[];
  classes: ClassEntity[];
  interfaces: InterfaceEntity[];
  variables: VariableEntity[];
  types: TypeEntity[];
  components: ComponentEntity[];
  /**
   * HAS_METHOD edge descriptors (Class → Function).
   * Optional: only produced by plugins that support class member extraction.
   */
  hasMethodEdges?: HasMethodEdgeDescriptor[];
  /**
   * HAS_PROPERTY edge descriptors (Class → Variable).
   * Optional: only produced by plugins that support class member extraction.
   */
  hasPropertyEdges?: HasPropertyEdgeDescriptor[];
  /**
   * Semantic type reference nodes (targets of HAS_PARAM / RETURNS / USES_TYPE edges).
   * Optional: only produced by plugins that support type-relationship extraction.
   */
  typeRefs?: TypeRefEntity[];
  /**
   * HAS_PARAM edge descriptors (Function → Type).
   * Optional: only produced by plugins that support parameter type extraction.
   */
  hasParamEdges?: HasParamEdgeDescriptor[];
  /**
   * RETURNS edge descriptors (Function → Type).
   * Optional: only produced by plugins that support return type extraction.
   */
  returnsEdges?: ReturnsEdgeDescriptor[];
  /**
   * USES_TYPE edge descriptors (Function → Type used in body).
   * Optional: only produced by plugins that support type usage extraction.
   */
  usesTypeEdges?: UsesTypeEdgeDescriptor[];
}

/**
 * Optional context handed to extractCalls so a language can resolve callees
 * across files. The file's own extracted imports are the only sanctioned
 * source of cross-file knowledge at extraction time; anything needing a
 * project-wide view belongs in a pipeline pass, not here.
 */
export interface CallExtractionContext {
  imports?: ImportEntity[];
}

/** Call reference for edge creation */
export interface CallReference {
  /** Canonical caller symbol id once resolved. */
  fromId?: string;
  /** Canonical callee symbol id once resolved. */
  toId?: string;
  callerName: string;
  calleeName: string;
  line: number;
  filePath: string;
  /**
   * Defining file of the callee when the extractor resolved it to another
   * file (via import analysis). Absent means same-file, which is what
   * buildCallEdgesFromRefs assumed unconditionally before this field.
   */
  calleeFilePath?: string;
}

/** Render reference for React component edges */
export interface RenderReference {
  /** Canonical rendering component id once resolved. */
  fromId?: string;
  /** Canonical rendered component id once resolved. */
  toId?: string;
  componentName: string;
  renderedComponent: string;
  line: number;
  filePath: string;
}

/** Inheritance reference for extends/implements edges */
export interface InheritanceReference {
  /** Canonical child declaration id once resolved. */
  fromId?: string;
  /** Canonical parent declaration id once resolved. */
  toId?: string;
  childName: string;
  parentName: string;
  type: 'extends' | 'implements';
  filePath: string;
}

// ============================================================================
// Entity Extractors Interface
// ============================================================================

/** Core entity extractors that every language must implement */
export interface CoreExtractors {
  /** Extract function/method declarations */
  extractFunctions(root: SyntaxNode, filePath: string): FunctionEntity[];

  /** Extract class declarations */
  extractClasses(root: SyntaxNode, filePath: string): ClassEntity[];

  /** Extract variable declarations */
  extractVariables(root: SyntaxNode, filePath: string): VariableEntity[];

  /** Extract import statements */
  extractImports(root: SyntaxNode, filePath: string): ImportEntity[];
}

/** Optional extractors that languages may implement */
export interface OptionalExtractors {
  /** Extract interface declarations (TypeScript, Java, C#) */
  extractInterfaces?(root: SyntaxNode, filePath: string): InterfaceEntity[];

  /** Extract type aliases (TypeScript) */
  extractTypes?(root: SyntaxNode, filePath: string): TypeEntity[];

  /** Extract React components (TypeScript/JavaScript with React) */
  extractComponents?(root: SyntaxNode, filePath: string): ComponentEntity[];

  /** Extract function calls for CALLS edges */
  extractCalls?(root: SyntaxNode, filePath: string, context?: CallExtractionContext): CallReference[];

  /** Extract render references for RENDERS edges (React) */
  extractRenders?(root: SyntaxNode, filePath: string): RenderReference[];

  /** Extract inheritance for EXTENDS/IMPLEMENTS edges */
  extractInheritance?(root: SyntaxNode, filePath: string): InheritanceReference[];
}

/** Combined entity extractors */
export interface EntityExtractors extends CoreExtractors, OptionalExtractors { }

// ============================================================================
// Language Plugin Interface
// ============================================================================

/** 
 * Language Plugin
 * Defines a language-specific parsing module that can be registered with the parser.
 */
export interface LanguagePlugin {
  /** Unique identifier for the language (e.g., 'typescript', 'python', 'rust') */
  id: string;

  /** Human-readable name (e.g., 'TypeScript', 'Python', 'Rust') */
  displayName: string;

  /** File extensions this plugin handles (e.g., ['.ts', '.tsx']) */
  extensions: string[];

  /**
   * Get the default tree-sitter grammar for this language.
   * Returns the language module that can be passed to parser.setLanguage()
   */
  getGrammar(): unknown;

  /**
   * Optional: Get the grammar for a specific file extension.
   * Used by languages like TypeScript that need separate grammars for
   * different extensions (e.g., TS vs TSX).
   * Falls back to getGrammar() if not implemented.
   */
  getGrammarForExtension?(ext: string): unknown;

  /** Entity extractors for this language */
  extractors: EntityExtractors;

  /** 
   * Optional: Get all entities from a file in one pass.
   * If not provided, the registry will call individual extractors.
   */
  extractAllEntities?(root: SyntaxNode, filePath: string): ExtractedEntities;
}

// ============================================================================
// Registry Types
// ============================================================================

/** Plugin registration result */
export interface PluginRegistration {
  success: boolean;
  languageId: string;
  extensions: string[];
  error?: string;
}

/** Registered plugin info (without internal details) */
export interface RegisteredPlugin {
  id: string;
  displayName: string;
  extensions: string[];
}
