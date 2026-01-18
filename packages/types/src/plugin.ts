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
  childCount: number;
  firstChild: SyntaxNode | null;
  lastChild: SyntaxNode | null;
  nextSibling: SyntaxNode | null;
  previousSibling: SyntaxNode | null;
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
}

/** Call reference for edge creation */
export interface CallReference {
  callerName: string;
  calleeName: string;
  line: number;
  filePath: string;
}

/** Render reference for React component edges */
export interface RenderReference {
  componentName: string;
  renderedComponent: string;
  line: number;
  filePath: string;
}

/** Inheritance reference for extends/implements edges */
export interface InheritanceReference {
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
  extractCalls?(root: SyntaxNode, filePath: string): CallReference[];

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
   * Get the tree-sitter grammar for this language.
   * Returns the language module that can be passed to parser.setLanguage()
   */
  getGrammar(): unknown;

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
