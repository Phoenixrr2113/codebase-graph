/**
 * @codegraph/core - Extraction Pipeline
 *
 * Shared extraction pipeline used by all consumers (API, CLI, MCP server).
 * Provides language-aware entity extraction, complexity enrichment, and
 * builds the complete ParsedFileEntities structure for graph persistence.
 *
 * Uses the language registry for dispatching extraction to the correct plugin.
 */

import Parser from 'tree-sitter';
import type { FileEntity, ParsedFileEntities, InheritanceReference, CallReference, LanguagePlugin, SyntaxNode as GenericSyntaxNode } from '@codegraph/types';
import {
  extractAllEntities,
  type ExtractedEntities,
  extractCalls as extractTsCalls,
  extractRenders,
  extractInheritance as extractTsInheritance,
  typescriptPlugin,
} from '@codegraph/plugin-typescript';
import { resolvePythonImport, pythonPlugin } from '@codegraph/plugin-python';
import { csharpPlugin } from '@codegraph/plugin-csharp';
import { javaPlugin } from '@codegraph/plugin-java';
import { goPlugin } from '@codegraph/plugin-go';
import { rustPlugin } from '@codegraph/plugin-rust';
import { phpPlugin } from '@codegraph/plugin-php';
import { languageRegistry } from './registry';
import { stat, readFile } from 'node:fs/promises';
import { basename, extname } from 'node:path';
import { createHash } from 'node:crypto';

// ============================================================================
// Plugin Registration
// ============================================================================

/** Whether plugins have been registered */
let pluginsRegistered = false;

/**
 * Register all tier-1 language plugins with the registry.
 * Safe to call multiple times — idempotent.
 */
export function registerPlugins(): void {
  if (pluginsRegistered) return;

  // Plugins use tree-sitter's SyntaxNode; registry uses generic SyntaxNode from @codegraph/types.
  // Structurally compatible but nominally different — cast through unknown.
  languageRegistry.register(typescriptPlugin as unknown as LanguagePlugin);
  languageRegistry.register(pythonPlugin as unknown as LanguagePlugin);
  languageRegistry.register(csharpPlugin as unknown as LanguagePlugin);
  languageRegistry.register(javaPlugin as unknown as LanguagePlugin);
  languageRegistry.register(goPlugin as unknown as LanguagePlugin);
  languageRegistry.register(rustPlugin as unknown as LanguagePlugin);
  languageRegistry.register(phpPlugin as unknown as LanguagePlugin);

  pluginsRegistered = true;
}

/** Whether tier-2 registration has been attempted */
let tier2Attempted = false;

/**
 * Register tier-2 languages (Ruby, Kotlin, Swift, C, C++, etc.)
 * by dynamically importing @codegraph/plugin-languages.
 *
 * Only grammars that are installed will be registered. Missing grammars
 * are silently skipped (optionalDependencies pattern).
 *
 * Safe to call multiple times — idempotent.
 * Automatically calls registerPlugins() first if needed.
 *
 * @returns Object with registered and skipped language lists
 */
export async function registerTier2Languages(): Promise<{
  registered: string[];
  skipped: string[];
}> {
  // Ensure tier-1 plugins are registered first
  registerPlugins();

  if (tier2Attempted) return { registered: [], skipped: [] };
  tier2Attempted = true;

  try {
    // @ts-ignore — optional package, may not be installed
    const mod = await import('@codegraph/plugin-languages');
    const registerAllLanguages = mod.registerAllLanguages as (
      registry: { register(plugin: any): void }
    ) => Promise<{ registered: string[]; skipped: string[] }>;
    return await registerAllLanguages(languageRegistry);
  } catch {
    // @codegraph/plugin-languages not installed — tier-2 unavailable
    return { registered: [], skipped: [] };
  }
}

// ============================================================================
// Constants
// ============================================================================

/** Markdown file extensions (non-tree-sitter, separate parser) */
export const MARKDOWN_EXTENSIONS: readonly string[] = ['.md', '.mdx', '.mdc'];

/** Default glob patterns to ignore during parsing and watching */
export const DEFAULT_IGNORE_PATTERNS: readonly string[] = [
  '**/node_modules/**',
  '**/dist/**',
  '**/build/**',
  '**/.git/**',
  '**/coverage/**',
  '**/*.test.ts',
  '**/*.test.tsx',
  '**/*.spec.ts',
  '**/*.spec.tsx',
  '**/__tests__/**',
  '**/__mocks__/**',
  '**/.next/**',
  '**/.turbo/**',
  '**/.codegraph/**',
  '**/__pycache__/**',
  '**/.venv/**',
  '**/venv/**',
  '**/*.pyc',
];

/**
 * Get all supported file extensions (code + markdown).
 * Derived dynamically from the language registry.
 * Must be called after registerPlugins().
 */
export function getSupportedExtensions(): string[] {
  return [...languageRegistry.getSupportedExtensions(), ...MARKDOWN_EXTENSIONS];
}


// ============================================================================
// Language Detection (Registry-Based)
// ============================================================================

/** Check if file is a Markdown file */
export function isMarkdownFile(filePath: string): boolean {
  const ext = extname(filePath).toLowerCase();
  return MARKDOWN_EXTENSIONS.includes(ext as typeof MARKDOWN_EXTENSIONS[number]);
}

/**
 * Get the language category for a file.
 * Queries the language registry dynamically — works for any registered language.
 */
export function getLanguageCategory(filePath: string): string {
  if (isMarkdownFile(filePath)) return 'markdown';
  const ext = extname(filePath).toLowerCase();
  return languageRegistry.getForExtension(ext)?.id ?? 'unknown';
}

// ============================================================================
// File Entity Creation
// ============================================================================

/**
 * Create a FileEntity from a file on disk.
 * Reads the file to compute hash, LOC, and mtime.
 */
export async function createFileEntity(filePath: string): Promise<FileEntity> {
  const fileStat = await stat(filePath);
  const content = await readFile(filePath, 'utf-8');
  return createFileEntityFromContent(filePath, content, fileStat.mtime);
}

/**
 * Create a FileEntity from already-read content (avoids a second disk read).
 * Used by the indexer when the content was already read for parsing.
 */
export function createFileEntityFromContent(filePath: string, content: string, mtime: Date): FileEntity {
  const loc = content.split('\n').length;
  const hash = createHash('sha256').update(content).digest('hex').slice(0, 16);

  return {
    path: filePath,
    name: basename(filePath),
    extension: extname(filePath).slice(1),
    loc,
    lastModified: mtime.toISOString(),
    hash,
  };
}

// ============================================================================
// Language-Aware Entity Extraction
// ============================================================================

/**
 * Extract entities from a parsed file's AST, dispatching to the correct
 * language plugin via the registry.
 */
export function extractEntitiesForFile(
  rootNode: Parser.SyntaxNode,
  filePath: string,
): ExtractedEntities {
  // Ensure plugins are registered
  registerPlugins();

  const ext = extname(filePath).toLowerCase();
  const plugin = languageRegistry.getForExtension(ext);

  if (plugin?.extractAllEntities) {
    return plugin.extractAllEntities(rootNode as unknown as GenericSyntaxNode, filePath);
  }

  // Fallback: use TypeScript extractors (default)
  return extractAllEntities(rootNode, filePath);
}

// ============================================================================
// Build ParsedFileEntities
// ============================================================================

/** Options for the extraction pipeline */
export interface PipelineOptions {
  deepAnalysis?: boolean;
  includeExternals?: boolean;
}

/**
 * Build extends/implements edges from InheritanceReference[] (non-TS languages).
 * Common logic previously duplicated per-language in buildParsedFileEntities.
 */
function buildInheritanceEdgesFromRefs(
  refs: InheritanceReference[],
  filePath: string,
  extracted: ExtractedEntities,
): { extendsEdges: ParsedFileEntities['extendsEdges']; implementsEdges: ParsedFileEntities['implementsEdges'] } {
  const extendsEdges: ParsedFileEntities['extendsEdges'] = [];
  const implementsEdges: ParsedFileEntities['implementsEdges'] = [];

  for (const ref of refs) {
    const cls = extracted.classes.find((c) => c.name === ref.childName);
    const iface = extracted.interfaces.find((i) => i.name === ref.childName);

    if (ref.type === 'extends') {
      if (cls) {
        extendsEdges.push({
          childId: `Class:${filePath}:${cls.name}:${cls.startLine}`,
          parentId: `Class:external:${ref.parentName}`,
        });
      } else if (iface) {
        extendsEdges.push({
          childId: `Interface:${filePath}:${iface.name}:${iface.startLine}`,
          parentId: `Interface:external:${ref.parentName}`,
        });
      }
    } else if (ref.type === 'implements' && cls) {
      implementsEdges.push({
        classId: `Class:${filePath}:${cls.name}:${cls.startLine}`,
        interfaceId: `Interface:external:${ref.parentName}`,
      });
    }
  }

  return { extendsEdges, implementsEdges };
}

/**
 * Build call edges from CallReference[] (non-TS languages).
 */
function buildCallEdgesFromRefs(refs: CallReference[]): ParsedFileEntities['callEdges'] {
  return refs.map((call) => ({
    callerId: `Function:${call.filePath}:${call.callerName}`,
    calleeId: `Function:${call.filePath}:${call.calleeName}`,
    line: call.line,
  }));
}

/**
 * Build the complete ParsedFileEntities structure from extracted entities.
 * Resolves imports, inheritance, calls, and renders into edge arrays
 * ready for graph persistence via batchUpsert().
 *
 * Uses the language registry (QUAL.12) to dispatch extraction to the
 * correct plugin, eliminating per-language if/else chains.
 */
export function buildParsedFileEntities(
  file: FileEntity,
  extracted: ExtractedEntities,
  rootNode?: Parser.SyntaxNode,
  options: PipelineOptions = {},
  projectRoot?: string,
): ParsedFileEntities {
  const { deepAnalysis = false, includeExternals = false } = options;

  // Ensure plugins are registered so registry lookups work
  registerPlugins();

  const lang = getLanguageCategory(file.path);
  const ext = extname(file.path).toLowerCase();
  const plugin = languageRegistry.getForExtension(ext);

  // Note: complexity metrics (cyclomatic, cognitive, nesting) are already
  // computed during entity extraction by parseFunctionNode() → calculateComplexity().
  // The previous enrichFunctionsWithComplexity() call was redundant (re-walked the
  // entire AST doing 1 + 3N additional traversals for N functions).

  // --- Import edges ---
  // Import resolution varies by language capability:
  // - TypeScript: TS extractor pre-resolves paths via resolvedPath field
  // - Python: resolvePythonImport() resolves module names to file paths
  // - All other languages: no file resolution, treated as external references
  const importsEdges: ParsedFileEntities['importsEdges'] = [];

  for (const imp of extracted.imports) {
    if (imp.resolvedPath) {
      // Pre-resolved path (TypeScript extractor populates this)
      importsEdges.push({
        fromFilePath: file.path,
        toFilePath: imp.resolvedPath,
        specifiers: imp.specifiers.map((s) => s.name),
      });
    } else if (lang === 'python' && projectRoot) {
      // Python: resolve module paths to file paths
      const resolvedPath = resolvePythonImport(imp.source, file.path, projectRoot);
      if (resolvedPath) {
        importsEdges.push({
          fromFilePath: file.path,
          toFilePath: resolvedPath,
          specifiers: imp.specifiers.map((s) => s.name),
        });
      }
    } else {
      // External import (no file resolution available)
      importsEdges.push({
        fromFilePath: file.path,
        toFilePath: `external:${imp.source}`,
        specifiers: imp.specifiers.map((s) => s.name),
      });
    }
  }

  // --- Extends / Implements edges ---
  // TypeScript uses a richer inheritance extractor that resolves parent types
  // across files via import analysis. Other languages use the generic
  // extractInheritance from their plugin, which returns simple name references.
  let extendsEdges: ParsedFileEntities['extendsEdges'] = [];
  let implementsEdges: ParsedFileEntities['implementsEdges'] = [];

  if (lang === 'typescript') {
    // TS-specific: cross-file inheritance resolution via import analysis
    const inheritance = extractTsInheritance(
      file.path,
      extracted.classes,
      extracted.interfaces,
      extracted.imports,
      includeExternals,
    );

    extendsEdges = inheritance.extends.map((ext) => ({
      childId: `Class:${ext.childFilePath}:${ext.childName}:${ext.childStartLine}`,
      parentId: ext.parentFilePath
        ? `Class:${ext.parentFilePath}:${ext.parentName}`
        : `Class:external:${ext.parentName}`,
    }));

    implementsEdges = inheritance.implements.map((impl) => ({
      classId: `Class:${impl.classFilePath}:${impl.className}:${impl.classStartLine}`,
      interfaceId: impl.interfaceFilePath
        ? `Interface:${impl.interfaceFilePath}:${impl.interfaceName}`
        : `Interface:external:${impl.interfaceName}`,
    }));
  } else if (plugin?.extractors.extractInheritance && rootNode) {
    // All other languages: use registry-dispatched extractInheritance
    const refs = plugin.extractors.extractInheritance(rootNode as unknown as GenericSyntaxNode, file.path);
    ({ extendsEdges, implementsEdges } = buildInheritanceEdgesFromRefs(refs, file.path, extracted));
  }

  // --- Call edges (deep analysis only) ---
  // TypeScript uses a richer call extractor that resolves callee identities
  // across files via import analysis. Other languages use the generic
  // extractCalls from their plugin, which returns simple name references.
  let callEdges: ParsedFileEntities['callEdges'] = [];
  if (deepAnalysis && rootNode) {
    if (lang === 'typescript') {
      // TS-specific: cross-file call resolution via import analysis
      const calls = extractTsCalls(
        rootNode,
        file.path,
        extracted.functions,
        extracted.imports,
        includeExternals,
      );
      callEdges = calls.map((call) => ({
        callerId: `Function:${call.callerFilePath}:${call.callerName}`,
        calleeId: call.calleeFilePath
          ? `Function:${call.calleeFilePath}:${call.calleeName}`
          : `Function:external:${call.calleeName}`,
        line: call.line,
      }));
    } else if (plugin?.extractors.extractCalls) {
      // All other languages: use registry-dispatched extractCalls
      const refs = plugin.extractors.extractCalls(rootNode as unknown as GenericSyntaxNode, file.path);
      callEdges = buildCallEdgesFromRefs(refs);
    }
  }

  // --- Render edges (deep analysis only, TypeScript/JavaScript React components) ---
  let rendersEdges: ParsedFileEntities['rendersEdges'] = [];
  if (deepAnalysis && rootNode && lang === 'typescript' && extracted.components.length > 0) {
    const renders = extractRenders(
      rootNode,
      file.path,
      extracted.components,
      extracted.imports,
      includeExternals,
    );
    rendersEdges = renders.map((render) => ({
      parentId: `Component:${render.parentFilePath}:${render.parentName}`,
      childId: render.childFilePath
        ? `Component:${render.childFilePath}:${render.childName}`
        : `Component:external:${render.childName}`,
      line: render.line,
    }));
  }

  return {
    file,
    functions: extracted.functions,
    classes: extracted.classes,
    interfaces: extracted.interfaces,
    variables: extracted.variables,
    types: extracted.types,
    components: extracted.components,
    imports: extracted.imports,
    callEdges,
    importsEdges,
    extendsEdges,
    implementsEdges,
    rendersEdges,
  };
}

// ============================================================================
// Counting Helpers
// ============================================================================

/** Count total entities in an extracted result */
export function countEntities(extracted: ExtractedEntities): number {
  return (
    extracted.imports.length +
    extracted.functions.length +
    extracted.classes.length +
    extracted.variables.length +
    extracted.types.length +
    extracted.interfaces.length +
    extracted.components.length
  );
}

/** Count total edges in a parsed file entities structure */
export function countEdges(parsed: ParsedFileEntities): number {
  return (
    parsed.callEdges.length +
    parsed.importsEdges.length +
    parsed.extendsEdges.length +
    parsed.implementsEdges.length +
    parsed.rendersEdges.length
  );
}
