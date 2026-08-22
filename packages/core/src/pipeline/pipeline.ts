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
import type { FileEntity, ParsedFileEntities, InheritanceReference, CallReference, LanguagePlugin, SyntaxNode as GenericSyntaxNode, ExtractedEntities, ImportEntity } from '@codegraph/types';
import {
  extractAllEntities,
  extractCalls as extractTsCalls,
  extractRenders,
  extractInheritance as extractTsInheritance,
  typescriptPlugin,
  type ReExportEntity,
  type ResolvedImportTarget,
  type ResolvedImportMap,
} from '@codegraph/plugin-typescript';
import { resolvePythonImport, pythonPlugin } from '@codegraph/plugin-python';
import { goPlugin } from '@codegraph/plugin-go';
import { rustPlugin } from '@codegraph/plugin-rust';
import { languageRegistry } from './registry';
import { stat, readFile } from 'node:fs/promises';
import { basename, extname } from 'node:path';
import { createHash } from 'node:crypto';
import { createLogger } from '@codegraph/logger';

const logger = createLogger({ namespace: 'Core:Pipeline' });

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
  languageRegistry.register(goPlugin as unknown as LanguagePlugin);
  languageRegistry.register(rustPlugin as unknown as LanguagePlugin);

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
    const result = await registerAllLanguages(languageRegistry);
    // registerAllLanguages() already isolates a per-language grammar load
    // failure (it just lands the language in `skipped`, see
    // packages/plugin-languages/src/grammar-loader.ts), so one bad grammar
    // never aborts registration of the rest. Log the outcome instead of
    // swallowing it, so a missing or broken grammar is visible somewhere.
    if (result.skipped.length > 0) {
      logger.warn(`Tier-2 languages unavailable (grammar not installed or failed to load): ${result.skipped.join(', ')}`);
    }
    if (result.registered.length > 0) {
      logger.info(`Tier-2 languages registered: ${result.registered.join(', ')}`);
    }
    return result;
  } catch (err) {
    // @codegraph/plugin-languages not installed, or registration itself
    // crashed. Tier-2 is unavailable, but tier-1 indexing must continue.
    logger.warn(`Tier-2 language registration failed, continuing with tier-1 languages only: ${err instanceof Error ? err.message : String(err)}`);
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
  /**
   * Cross-file barrel re-export index: filePath -> that file's re-export
   * entries (from `extractReExports`), covering every TypeScript file in the
   * batch being indexed. When provided (together with `localExportsIndex`,
   * below), TypeScript CALL edges and TypeRefs whose target resolves through
   * a barrel chain (`export * from '...'`, `export { x } from '...'`) are
   * rewritten to point at the chain's origin file instead of the barrel.
   *
   * Building this index requires every file's re-exports to already be known,
   * so it is only meaningful for a full/batch index where the caller has
   * parsed the whole project up front. A single-file reindex
   * (`indexSingleFile`) has no sibling files in memory and must omit this
   * option: call sites simply see barrel-pointing callees unresolved, same as
   * before this fix (see buildResolvedImportMap below).
   */
  barrelIndex?: ReadonlyMap<string, ReExportEntity[]>;
  /**
   * Cross-file local-exports index: filePath -> the set of names that file
   * exports via its OWN declaration or a source-less `export { x }` (from
   * `extractLocalExportedNames`), not a re-export of another module.
   *
   * Needed alongside `barrelIndex` so a barrel that both re-exports from
   * elsewhere (`export * from './other'`) AND declares its own export under
   * the same name resolves to its own declaration, not the unrelated
   * re-export (see resolveReExportChain's local-declaration base case).
   * Files with no local exports, or not covered at all, simply never hit the
   * base case: chain-following falls through to the re-export checks as
   * before, so a sparse/missing index degrades gracefully rather than
   * mis-resolving.
   */
  localExportsIndex?: ReadonlyMap<string, readonly string[]>;
}

type SourceSymbolLabel = 'Function' | 'Class' | 'Interface' | 'Variable' | 'Type' | 'Component';

interface CatalogSymbol {
  id: string;
  label: SourceSymbolLabel;
  filePath: string;
  name: string;
  scopeKey: string;
  disambiguator: string;
  isOverloadSignature?: boolean;
  isExported: boolean;
  startLine: number;
}

export interface PersistedCatalogSymbol extends CatalogSymbol {}

export interface ProjectSymbolCatalog {
  readonly byId: ReadonlyMap<string, CatalogSymbol>;
  readonly byDeclaration: ReadonlyMap<string, readonly CatalogSymbol[]>;
  readonly byExport: ReadonlyMap<string, readonly CatalogSymbol[]>;
}

interface SymbolLookup {
  labels: readonly SourceSymbolLabel[];
  filePath: string;
  name: string;
  startLine?: number;
  ownerName?: string;
  exportedOnly?: boolean;
}

interface EdgeResolutionHint {
  from?: SymbolLookup;
  to?: SymbolLookup;
}

const edgeResolutionHints = new WeakMap<object, EdgeResolutionHint>();

const SYMBOL_COLLECTIONS = [
  ['Function', 'functions'],
  ['Class', 'classes'],
  ['Interface', 'interfaces'],
  ['Variable', 'variables'],
  ['Type', 'types'],
  ['Component', 'components'],
] as const;

function declarationKey(label: SourceSymbolLabel, filePath: string, name: string): string {
  return `${label}\u0000${filePath}\u0000${name}`;
}

function exportKey(filePath: string, name: string): string {
  return `${filePath}\u0000${name}`;
}

function symbolStartLine(symbol: { startLine?: number; line?: number }): number {
  return symbol.startLine ?? symbol.line ?? 0;
}

function symbolsFromParsed(parsed: ParsedFileEntities): CatalogSymbol[] {
  const symbols: CatalogSymbol[] = [];
  for (const [label, collection] of SYMBOL_COLLECTIONS) {
    for (const symbol of parsed[collection]) {
      symbols.push({
        id: symbol.id,
        label,
        filePath: symbol.filePath,
        name: symbol.name,
        scopeKey: symbol.scopeKey,
        disambiguator: symbol.disambiguator,
        isOverloadSignature: label === 'Function'
          && 'isOverloadSignature' in symbol
          && symbol.isOverloadSignature === true,
        isExported: symbol.isExported,
        startLine: symbolStartLine(symbol),
      });
    }
  }
  return symbols;
}

export function currentSymbolIds(parsed: ParsedFileEntities): string[] {
  return symbolsFromParsed(parsed).map(symbol => symbol.id);
}

export function buildProjectSymbolCatalog(
  parsedList: readonly ParsedFileEntities[],
  persistedSymbols: readonly PersistedCatalogSymbol[] = [],
): ProjectSymbolCatalog {
  const changedFiles = new Set(parsedList.map(parsed => parsed.file.path));
  const symbols = [
    ...persistedSymbols.filter(symbol => !changedFiles.has(symbol.filePath)),
    ...parsedList.flatMap(symbolsFromParsed),
  ];
  const byId = new Map<string, CatalogSymbol>();
  const byDeclaration = new Map<string, CatalogSymbol[]>();
  const byExport = new Map<string, CatalogSymbol[]>();

  for (const symbol of symbols) {
    byId.set(symbol.id, symbol);
    if (symbol.isOverloadSignature === true) continue;
    const declared = declarationKey(symbol.label, symbol.filePath, symbol.name);
    const declarationMatches = byDeclaration.get(declared) ?? [];
    declarationMatches.push(symbol);
    byDeclaration.set(declared, declarationMatches);
    if (symbol.isExported && symbol.scopeKey.length === 0) {
      const exported = exportKey(symbol.filePath, symbol.name);
      const exportMatches = byExport.get(exported) ?? [];
      exportMatches.push(symbol);
      byExport.set(exported, exportMatches);
    }
  }

  return { byId, byDeclaration, byExport };
}

function resolveLookup(catalog: ProjectSymbolCatalog, lookup: SymbolLookup): CatalogSymbol[] {
  let matches = lookup.exportedOnly
    ? [...(catalog.byExport.get(exportKey(lookup.filePath, lookup.name)) ?? [])]
    : lookup.labels.flatMap(label => catalog.byDeclaration.get(
      declarationKey(label, lookup.filePath, lookup.name),
    ) ?? []);
  matches = matches.filter(symbol => lookup.labels.includes(symbol.label));
  if (lookup.ownerName) {
    const owner = `Class:${lookup.ownerName}`;
    matches = matches.filter(symbol =>
      symbol.scopeKey === owner || symbol.scopeKey.endsWith(`/${owner}`),
    );
  }
  if (lookup.startLine !== undefined) {
    const atLine = matches.filter(symbol => symbol.startLine === lookup.startLine);
    if (atLine.length > 0) matches = atLine;
  }
  return matches;
}

function resolveSingleEndpoint(
  currentId: string,
  lookup: SymbolLookup | undefined,
  catalog: ProjectSymbolCatalog,
): string | undefined {
  if (currentId && catalog.byId.has(currentId)) return currentId;
  if (!lookup) return undefined;
  const matches = resolveLookup(catalog, lookup);
  return matches.length === 1 ? matches[0]?.id : undefined;
}

export function resolveProjectSymbolEdges(
  parsedList: readonly ParsedFileEntities[],
  catalog: ProjectSymbolCatalog,
): void {
  for (const parsed of parsedList) {
    parsed.callEdges = parsed.callEdges.flatMap(edge => {
      const hint = edgeResolutionHints.get(edge);
      const callerId = resolveSingleEndpoint(edge.callerId, hint?.from, catalog);
      const calleeMatches = edge.calleeId && catalog.byId.has(edge.calleeId)
        ? [catalog.byId.get(edge.calleeId)!]
        : hint?.to ? resolveLookup(catalog, hint.to) : [];
      const implementationMatches = calleeMatches.filter(
        target => target.isOverloadSignature !== true,
      );
      if (!callerId || implementationMatches.length === 0) return [];
      return implementationMatches.map(target => ({ ...edge, callerId, calleeId: target.id }));
    });

    parsed.importsSymbolEdges = parsed.importsSymbolEdges.flatMap(edge => {
      const hint = edgeResolutionHints.get(edge);
      const targets = edge.toId && catalog.byId.has(edge.toId)
        ? [catalog.byId.get(edge.toId)!]
        : hint?.to ? resolveLookup(catalog, hint.to) : [];
      return targets.map(target => ({
        ...edge,
        fromId: edge.fromId ?? `File:${edge.fromFilePath}`,
        toId: target.id,
      }));
    });

    parsed.extendsEdges = parsed.extendsEdges.flatMap(edge => {
      const hint = edgeResolutionHints.get(edge);
      const childId = resolveSingleEndpoint(edge.childId, hint?.from, catalog);
      const parentId = resolveSingleEndpoint(edge.parentId, hint?.to, catalog);
      return childId && parentId ? [{ childId, parentId }] : [];
    });

    parsed.implementsEdges = parsed.implementsEdges.flatMap(edge => {
      const hint = edgeResolutionHints.get(edge);
      const classId = resolveSingleEndpoint(edge.classId, hint?.from, catalog);
      const interfaceId = resolveSingleEndpoint(edge.interfaceId, hint?.to, catalog);
      return classId && interfaceId ? [{ classId, interfaceId }] : [];
    });

    parsed.rendersEdges = parsed.rendersEdges.flatMap(edge => {
      const hint = edgeResolutionHints.get(edge);
      const parentId = resolveSingleEndpoint(edge.parentId, hint?.from, catalog);
      const childId = resolveSingleEndpoint(edge.childId, hint?.to, catalog);
      return parentId && childId ? [{ ...edge, parentId, childId }] : [];
    });

    parsed.exportsEdges = parsed.exportsEdges.flatMap(edge => {
      const hint = edgeResolutionHints.get(edge);
      const toId = resolveSingleEndpoint(edge.toId ?? '', hint?.to, catalog);
      return toId ? [{ ...edge, fromId: edge.fromId ?? `File:${edge.filePath}`, toId }] : [];
    });
  }
}

// ============================================================================
// Barrel re-export chain resolution (batch/full-index only)
// ============================================================================

/** Bound on how many `export * from` / `export { x } from` hops to follow
 *  before giving up on a chain. Generous for real-world barrel nesting while
 *  still cheap, and doubles as a hard stop if `reExportsByFile` somehow
 *  contains a chain the visited-set guard didn't already catch. */
const MAX_BARREL_CHAIN_DEPTH = 16;

/** Empty map constant, reused when a caller omits localExportsIndex so the
 *  local-declaration base case simply never fires (safe no-op), instead of
 *  allocating a fresh empty Map on every buildParsedFileEntities call. */
const EMPTY_LOCAL_EXPORTS: ReadonlyMap<string, readonly string[]> = new Map();

/**
 * Build the cross-file barrel index `buildParsedFileEntities` accepts via
 * `PipelineOptions.barrelIndex`, from a per-file list of re-export entries.
 * Files with no re-exports are omitted (they're not barrels).
 */
export function buildReExportIndex(
  entries: Array<{ filePath: string; reExports: ReExportEntity[] }>,
): Map<string, ReExportEntity[]> {
  const index = new Map<string, ReExportEntity[]>();
  for (const { filePath, reExports } of entries) {
    if (reExports.length > 0) index.set(filePath, reExports);
  }
  return index;
}

/**
 * Build the cross-file local-exports index `buildParsedFileEntities` accepts
 * via `PipelineOptions.localExportsIndex`, from a per-file list of locally
 * exported names (from `extractLocalExportedNames`). Files that export
 * nothing locally are omitted (an absent entry and an empty array behave
 * identically at lookup time, so this just keeps the index small).
 *
 * Plain arrays, not Sets: per-file local-export lists are small (a handful
 * of names), and this shape matches what the indexer pre-pass already
 * produces directly (no Set conversion needed at the call site).
 */
export function buildLocalExportsIndex(
  entries: Array<{ filePath: string; names: string[] }>,
): Map<string, readonly string[]> {
  const index = new Map<string, readonly string[]>();
  for (const { filePath, names } of entries) {
    if (names.length > 0) index.set(filePath, names);
  }
  return index;
}

/**
 * Bound on the TOTAL number of (file, name) resolution attempts across one
 * `resolveReExportChain` call, shared across every branch it explores (not
 * reset per branch or per depth level). MAX_BARREL_CHAIN_DEPTH alone only
 * bounds how deep any single path goes; a barrel with several `export *`
 * statements, each pointing at another multi-star barrel, branches at every
 * hop, so depth alone does not bound total work: worst case for unbounded
 * branching is O(branching^depth). This budget converts that into a hard
 * O(MAX_TOTAL_RESOLUTION_ATTEMPTS) cap regardless of fan-out shape: once
 * exhausted, unexplored candidates are treated as unresolved, the same
 * fail-safe ("never guess, only give up") this resolver already relies on
 * for an unresolvable source or a spent depth budget.
 *
 * Honest worst case: a barrel of, say, 20 `export *` statements each
 * pointing at another 20-star barrel would need 20 + 400 + 8000 + ...
 * attempts to explore exhaustively, which blows past 1024 by the third
 * level and safely aborts there rather than continuing to explore. Real
 * barrel graphs (a handful of re-exports, one to three hops deep) use at
 * most a few dozen attempts, nowhere near the cap. Per-attempt work is O(the
 * re-export entries in that one file) to scan for a match, plus O(depth) to
 * copy the per-path visited set (see below), so total work in the worst
 * case is bounded by MAX_TOTAL_RESOLUTION_ATTEMPTS * (a small constant +
 * MAX_BARREL_CHAIN_DEPTH), comfortably sub-millisecond.
 */
const MAX_TOTAL_RESOLUTION_ATTEMPTS = 1024;

/**
 * Follow a re-export chain starting at `startFile`, looking for the file
 * that actually declares `symbolName` and the name it is declared under
 * there (which may differ from `symbolName` itself after following a rename
 * like `export { x as y } from '...'`).
 *
 * Resolution order at each hop, matching how a real module resolver treats a
 * file that is both a barrel and a declarer:
 *   1. Local-declaration base case: if the current file locally declares
 *      the name currently being chased (per `localExportsByFile`), stop
 *      here, even if the file ALSO has unrelated re-exports. A file that
 *      does `export * from './other'` and also `export function f() {}`
 *      must resolve `f` to itself, not follow the star into `./other`.
 *   2. A matching named re-export (`export { x as y } from '...'`): follow
 *      it, rewriting the chased name to the origin-side declared name so
 *      the NEXT hop (and the eventual caller) searches for the name that
 *      actually exists there, not the local alias. A named match is
 *      authoritative (only one can match a given name at one hop): it
 *      commits to its own result, success or failure, rather than falling
 *      back to try star siblings.
 *   3. Every matching star re-export (`export * from '...'`), tried in
 *      declaration order: a barrel can have more than one, and which one
 *      (if any) actually declares the chased name is genuinely ambiguous
 *      until tried. The first star whose subtree actually resolves the name
 *      wins; a star that doesn't pan out (or points somewhere unresolvable)
 *      is skipped in favor of the next one, instead of the old behavior of
 *      always following only the first star regardless of which name was
 *      being chased (the exact bug this fixes: `export * from './moduleA';
 *      export * from './moduleB';` used to resolve every name through
 *      moduleA.ts, silently dropping or mis-keying anything actually
 *      declared in moduleB.ts). Declaration order is preserved as the
 *      tie-break for the legitimate case of the same name being genuinely
 *      reachable through more than one star.
 *   4. None of the above resolves it at this file: unresolved from here.
 *
 * Cycle guard: PER-PATH visited set, not one shared across sibling star
 * branches. Each recursive call receives its own copy (extended with the
 * current file) to pass to its children; a sibling star branch always
 * starts from the parent's set, unpolluted by whatever an earlier sibling's
 * (possibly failed) subtree visited. A single shared, mutated-in-place set
 * would wrongly block a legitimate second branch that revisits a file
 * already seen (and abandoned) on a FAILED first branch, e.g. barrel.ts
 * does `export * from './a'; export * from './shared'` and a.ts ALSO does
 * `export * from './shared'`: chasing a name only shared.ts declares must
 * still succeed via barrel.ts's second star even though the first star's
 * subtree already visited (and, for an unrelated name, abandoned)
 * shared.ts. The mild recomputation cost (copying a small Set at every hop)
 * is bounded by MAX_TOTAL_RESOLUTION_ATTEMPTS * MAX_BARREL_CHAIN_DEPTH
 * element-copies in the worst case, negligible in practice.
 *
 * Bounded by a visited-set (cycle guard), MAX_BARREL_CHAIN_DEPTH (how deep
 * any one path goes), and MAX_TOTAL_RESOLUTION_ATTEMPTS (total work across
 * every branch), so neither a re-export cycle nor a wide star fan-out can
 * hang or blow up. On a cycle, unresolved hop, exhausted depth/attempt
 * budget, or a name that's genuinely declared nowhere reachable, falls back
 * to the starting file and name, best-effort, never throws.
 */
export function resolveReExportChain(
  startFile: string,
  symbolName: string,
  reExportsByFile: ReadonlyMap<string, ReExportEntity[]>,
  localExportsByFile: ReadonlyMap<string, readonly string[]> = EMPTY_LOCAL_EXPORTS,
): ResolvedImportTarget {
  let attempts = 0;

  function attempt(
    file: string,
    name: string,
    visited: ReadonlySet<string>,
    depth: number,
  ): ResolvedImportTarget | undefined {
    attempts++;
    if (attempts > MAX_TOTAL_RESOLUTION_ATTEMPTS) return undefined; // global work budget exhausted
    if (depth >= MAX_BARREL_CHAIN_DEPTH) return undefined; // this path alone is too deep
    if (visited.has(file)) return undefined; // cycle on this path: dead end for this branch

    if (localExportsByFile.get(file)?.includes(name)) {
      return { filePath: file, exportedName: name }; // this file declares it itself
    }

    const reExports = reExportsByFile.get(file);
    if (!reExports || reExports.length === 0) {
      // No barrel data for this file. If we positively know its full local
      // export surface (a defined list that just doesn't include `name`)
      // and it isn't a barrel either, it definitively does not declare
      // `name`: fail, so a sibling star branch elsewhere gets a chance.
      // Otherwise there is no information at all about this file (never
      // scanned, e.g. outside the indexed root): conservatively assume it's
      // the origin, matching this resolver's long-standing behavior for a
      // plain, uninstrumented file.
      return localExportsByFile.get(file) !== undefined
        ? undefined
        : { filePath: file, exportedName: name };
    }

    const nextVisited = new Set(visited);
    nextVisited.add(file);

    const namedMatch = reExports.find(
      (r) => r.exportedName !== '*' && (r.localName ?? r.exportedName) === name,
    );
    if (namedMatch) {
      if (!namedMatch.sourceResolvedPath) return { filePath: file, exportedName: name }; // re-export source unresolved, stop here
      return attempt(namedMatch.sourceResolvedPath, namedMatch.exportedName, nextVisited, depth + 1);
    }

    for (const star of reExports) {
      if (star.exportedName !== '*' || star.localName) continue;
      if (!star.sourceResolvedPath) continue; // unresolvable external star: not a viable candidate, try the next one
      const result = attempt(star.sourceResolvedPath, name, nextVisited, depth + 1);
      if (result) return result; // first star branch that actually resolves the name wins
    }

    return undefined; // nothing in this file resolves `name`
  }

  return attempt(startFile, symbolName, new Set(), 0) ?? { filePath: startFile, exportedName: symbolName };
}

/**
 * Build a barrel-chain- and alias-aware resolution map for a file's imported
 * names, for feeding to the TS calls extractor and (via extractAllEntities's
 * resolvedImports parameter) the type-ref extractor's cross-file resolution.
 *
 * Each named specifier and default import is chased independently through
 * `resolveReExportChain`, since two specifiers imported from the same
 * statement can originate from different files (`import { A, B } from
 * './barrel'` where the barrel re-exports A from one module and B from
 * another). For a plain, non-barrel, non-renamed import, the chain resolves
 * in one hop to the import's own resolvedPath under the same name, so this
 * map is safe (and correct) to build unconditionally for every named/default
 * import in a file, not just ones that are known to target a barrel.
 *
 * Namespace imports (`import * as NS from '...'`) are intentionally excluded:
 * they bind a whole module, not one exported name, so there is no single
 * symbol to chase through a barrel's re-export list. Callers keep resolving
 * them via the existing same-file namespace-import path.
 *
 * This produces a MAP, not a rewritten ImportEntity array: the caller (calls
 * extractor, type-ref extractor) looks up the map by local name and uses the
 * result's `exportedName` as the actual name to search for in the graph.
 * `extracted.imports` itself (and the File-to-File IMPORTS edge built from
 * it) must stay untouched by this map: that edge points at the barrel, which
 * is the truthful import relationship.
 */
export function buildResolvedImportMap(
  imports: ImportEntity[],
  reExportsByFile: ReadonlyMap<string, ReExportEntity[]>,
  localExportsByFile: ReadonlyMap<string, readonly string[]> = EMPTY_LOCAL_EXPORTS,
): ResolvedImportMap {
  const map = new Map<string, ResolvedImportTarget>();

  for (const imp of imports) {
    if (!imp.resolvedPath) continue; // unresolved/external import, nothing to chase
    const resolvedPath = imp.resolvedPath;

    for (const spec of imp.specifiers) {
      const localName = spec.alias ?? spec.name;
      map.set(localName, resolveReExportChain(resolvedPath, spec.name, reExportsByFile, localExportsByFile));
    }

    if (imp.isDefault && imp.defaultAlias) {
      map.set(imp.defaultAlias, resolveReExportChain(resolvedPath, 'default', reExportsByFile, localExportsByFile));
    }
  }

  return map;
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
        const edge = { childId: ref.fromId ?? cls.id, parentId: ref.toId ?? '' };
        edgeResolutionHints.set(edge, {
          from: { labels: ['Class'], filePath, name: cls.name, startLine: cls.startLine },
          to: { labels: ['Class'], filePath, name: ref.parentName },
        });
        extendsEdges.push(edge);
      } else if (iface) {
        const edge = { childId: ref.fromId ?? iface.id, parentId: ref.toId ?? '' };
        edgeResolutionHints.set(edge, {
          from: { labels: ['Interface'], filePath, name: iface.name, startLine: iface.startLine },
          to: { labels: ['Interface'], filePath, name: ref.parentName },
        });
        extendsEdges.push(edge);
      }
    } else if (ref.type === 'implements' && cls) {
      const edge = { classId: ref.fromId ?? cls.id, interfaceId: ref.toId ?? '' };
      edgeResolutionHints.set(edge, {
        from: { labels: ['Class'], filePath, name: cls.name, startLine: cls.startLine },
        to: { labels: ['Interface'], filePath, name: ref.parentName },
      });
      implementsEdges.push(edge);
    }
  }

  return { extendsEdges, implementsEdges };
}

/**
 * Build EXPORTS edge descriptors (File to exported top-level symbol) from
 * every language's `isExported` flag. Class members can inherit that flag
 * from their owning class, so the plugin-provided HAS_METHOD/HAS_PROPERTY
 * descriptors are the authoritative signal for excluding member entities.
 */
function collectExportsEdges(file: FileEntity, extracted: ExtractedEntities): ParsedFileEntities['exportsEdges'] {
  const edges: ParsedFileEntities['exportsEdges'] = [];
  const memberIds = new Set([
    ...(extracted.hasMethodEdges ?? []).map((edge) => edge.toId),
    ...(extracted.hasPropertyEdges ?? []).map((edge) => edge.toId),
  ]);
  const push = (
    id: string,
    name: string,
    isExported: boolean,
    symbolKind: ParsedFileEntities['exportsEdges'][number]['symbolKind'],
  ): void => {
    if (isExported && !memberIds.has(id)) {
      const edge = {
        fromId: `File:${file.path}`,
        toId: id,
        filePath: file.path,
        symbolName: name,
        symbolKind,
      };
      edgeResolutionHints.set(edge, {
        to: { labels: [symbolKind], filePath: file.path, name, exportedOnly: true },
      });
      edges.push(edge);
    }
  };
  for (const fn of extracted.functions) push(fn.id, fn.name, fn.isExported, 'Function');
  for (const cls of extracted.classes) push(cls.id, cls.name, cls.isExported, 'Class');
  for (const iface of extracted.interfaces) push(iface.id, iface.name, iface.isExported, 'Interface');
  for (const v of extracted.variables) push(v.id, v.name, v.isExported, 'Variable');
  for (const t of extracted.types) push(t.id, t.name, t.isExported, 'Type');
  for (const comp of extracted.components) push(comp.id, comp.name, comp.isExported, 'Component');
  return edges;
}

/**
 * Build IMPORTS_SYMBOL edge descriptors (importing File to the imported
 * symbol node, not the imported File) from every resolved import's named
 * specifiers. `resolvedImportMap`, when supplied, has already chased a local
 * name through a barrel chain to its true origin (see buildResolvedImportMap
 * above); otherwise the specifier's own declared name plus the import's
 * resolvedPath stand in, which is already correct for a plain, non-barrel
 * import (resolves in one hop either way).
 *
 * Namespace imports (`import * as NS from '...'`) are excluded, same
 * reasoning as buildResolvedImportMap: they bind a whole module, not one
 * exported name, so there's no single declared symbol to point at.
 */
function collectImportsSymbolEdges(
  file: FileEntity,
  extracted: ExtractedEntities,
  resolvedImportMap: ResolvedImportMap | undefined,
): ParsedFileEntities['importsSymbolEdges'] {
  const edges: ParsedFileEntities['importsSymbolEdges'] = [];
  for (const imp of extracted.imports) {
    if (!imp.resolvedPath) continue; // unresolved/external import: no target file to point at
    const resolvedPath = imp.resolvedPath;
    for (const spec of imp.specifiers) {
      const localName = spec.alias ?? spec.name;
      const resolved = resolvedImportMap?.get(localName);
      const edge: ParsedFileEntities['importsSymbolEdges'][number] = {
        fromId: `File:${file.path}`,
        fromFilePath: file.path,
        toFilePath: resolved?.filePath ?? resolvedPath,
        symbolName: resolved?.exportedName ?? spec.name,
        isDefault: false,
      };
      if (spec.alias) edge.alias = spec.alias;
      edgeResolutionHints.set(edge, {
        to: {
          labels: ['Function', 'Class', 'Interface', 'Variable', 'Type', 'Component'],
          filePath: edge.toFilePath,
          name: edge.symbolName,
          exportedOnly: true,
        },
      });
      edges.push(edge);
    }
  }
  return edges;
}

/**
 * Build call edges from CallReference[] (non-TS languages).
 */
function buildCallEdgesFromRefs(
  refs: CallReference[],
  extracted: ExtractedEntities,
): ParsedFileEntities['callEdges'] {
  // Non-TS plugins haven't been migrated to attribution-aware extraction yet.
  // They produce CallReferences with `callerName` only (no kind), defaulting
  // to Function caller and via='direct': the same defaults the old
  // TypeScript path used, so behavior is unchanged for those plugins.
  return refs.map((call) => {
    const caller = extracted.functions.find(fn => fn.name === call.callerName);
    const edge = {
      callerId: call.fromId ?? caller?.id ?? '',
      calleeId: call.toId ?? '',
      line: call.line,
      callerKind: 'Function' as const,
      via: 'direct' as const,
    };
    edgeResolutionHints.set(edge, {
      from: { labels: ['Function'], filePath: call.filePath, name: call.callerName },
      to: {
        labels: ['Function'],
        filePath: call.calleeFilePath ?? call.filePath,
        name: call.calleeName,
        exportedOnly: call.calleeFilePath !== undefined && call.calleeFilePath !== call.filePath,
      },
    });
    return edge;
  });
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
  const { deepAnalysis = false, includeExternals = false, barrelIndex, localExportsIndex } = options;

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
      // Python: resolve module paths to file paths. Specifier names are
      // passed through for the bare-dot `from . import <name>` form, where
      // `<name>` might name a submodule file rather than a symbol in the
      // package's own __init__.py (see resolvePythonImport's specifierNames
      // param).
      const resolvedPath = resolvePythonImport(
        imp.source,
        file.path,
        projectRoot,
        imp.specifiers.map((s) => s.name),
      );
      if (resolvedPath) {
        // Backfill onto the ImportEntity itself (not just the edge), so the
        // generic call-extraction dispatch below can resolve a cross-file
        // callee through this same import via CallExtractionContext, the
        // same way the TS extractor's imports already carry resolvedPath by
        // the time calls are extracted.
        imp.resolvedPath = resolvedPath;
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

    extendsEdges = inheritance.extends.map((ext) => {
      const child = extracted.classes.find(cls =>
        cls.name === ext.childName && cls.startLine === ext.childStartLine,
      );
      const edge = { childId: ext.fromId ?? child?.id ?? '', parentId: ext.toId ?? '' };
      if (ext.parentFilePath) {
        edgeResolutionHints.set(edge, {
          from: {
            labels: ['Class'],
            filePath: ext.childFilePath,
            name: ext.childName,
            startLine: ext.childStartLine,
          },
          to: { labels: ['Class'], filePath: ext.parentFilePath, name: ext.parentName },
        });
      }
      return edge;
    });

    implementsEdges = inheritance.implements.map((impl) => {
      const child = extracted.classes.find(cls =>
        cls.name === impl.className && cls.startLine === impl.classStartLine,
      );
      const edge = { classId: impl.fromId ?? child?.id ?? '', interfaceId: impl.toId ?? '' };
      if (impl.interfaceFilePath) {
        edgeResolutionHints.set(edge, {
          from: {
            labels: ['Class'],
            filePath: impl.classFilePath,
            name: impl.className,
            startLine: impl.classStartLine,
          },
          to: { labels: ['Interface'], filePath: impl.interfaceFilePath, name: impl.interfaceName },
        });
      }
      return edge;
    });
  } else if (plugin?.extractors.extractInheritance && rootNode) {
    // All other languages: use registry-dispatched extractInheritance
    const refs = plugin.extractors.extractInheritance(rootNode as unknown as GenericSyntaxNode, file.path);
    ({ extendsEdges, implementsEdges } = buildInheritanceEdgesFromRefs(refs, file.path, extracted));
  }

  // Barrel-chain- and alias-aware import resolution, shared by call
  // resolution below AND (further down) TypeRef resolution. Only built when
  // a barrelIndex was supplied (full/batch index, see PipelineOptions.barrelIndex);
  // otherwise both consumers fall back to their pre-barrel-fix behavior.
  // localExportsIndex is optional even then, it only sharpens the mixed-barrel
  // case (PipelineOptions.localExportsIndex); its absence degrades gracefully.
  const resolvedImportMap: ResolvedImportMap | undefined =
    lang === 'typescript' && barrelIndex && barrelIndex.size > 0
      ? buildResolvedImportMap(extracted.imports, barrelIndex, localExportsIndex ?? EMPTY_LOCAL_EXPORTS)
      : undefined;

  // --- EXPORTS edges (File → exported symbol) ---
  const exportsEdges = collectExportsEdges(file, extracted);

  // --- IMPORTS_SYMBOL edges (importing File → the imported symbol node) ---
  const importsSymbolEdges = collectImportsSymbolEdges(file, extracted, resolvedImportMap);

  // --- Call edges (deep analysis only) ---
  // TypeScript uses a richer call extractor that resolves callee identities
  // across files via import analysis. Other languages use the generic
  // extractCalls from their plugin, which returns simple name references.
  let callEdges: ParsedFileEntities['callEdges'] = [];
  if (deepAnalysis && rootNode) {
    if (lang === 'typescript') {
      // TS-specific: cross-file call resolution via import analysis.
      // extracted.imports itself is untouched by resolvedImportMap, so the
      // File IMPORTS edge built above still (truthfully) points at the barrel
      // when a callee is reached through one.
      const calls = extractTsCalls(
        rootNode,
        file.path,
        extracted.functions,
        extracted.imports,
        includeExternals,
        extracted.classes,
        resolvedImportMap,
      );
      callEdges = calls.map((call) => {
        const callerCollection = call.callerKind === 'Function'
          ? extracted.functions
          : call.callerKind === 'Variable'
            ? extracted.variables
            : call.callerKind === 'Class'
              ? extracted.classes
              : extracted.interfaces;
        const caller = callerCollection.find(candidate =>
          candidate.name === call.callerName && symbolStartLine(candidate) === call.callerStartLine,
        );
        const edge: ParsedFileEntities['callEdges'][number] = {
          callerId: call.fromId ?? caller?.id ?? '',
          calleeId: call.toId ?? '',
          line: call.line,
          callerKind: call.callerKind,
          via: call.via,
        };
        if (call.calleeClassName) edge.calleeClassName = call.calleeClassName;
        if (call.calleeFilePath) {
          edgeResolutionHints.set(edge, {
            from: {
              labels: [call.callerKind],
              filePath: call.callerFilePath,
              name: call.callerName,
              startLine: call.callerStartLine,
            },
            to: {
              labels: ['Function'],
              filePath: call.calleeFilePath,
              name: call.calleeName,
              ...(call.calleeClassName ? { ownerName: call.calleeClassName } : {}),
              exportedOnly: call.calleeFilePath !== call.callerFilePath && !call.calleeClassName,
            },
          });
        }
        return edge;
      });
    } else if (plugin?.extractors.extractCalls) {
      // All other languages: use registry-dispatched extractCalls.
      // extracted.imports is passed as context so a plugin whose imports
      // carry a resolvedPath (Python, now that resolvePythonImport backfills
      // it above, and any tier-2 config language whose own extractImports
      // resolves real file paths) can resolve a cross-file callee instead of
      // dropping it. Imports are already fully extracted by this point
      // (extractEntitiesForFile ran before buildParsedFileEntities, and the
      // Python resolvedPath backfill above happens earlier in this same
      // function), so the ordering is safe.
      const refs = plugin.extractors.extractCalls(rootNode as unknown as GenericSyntaxNode, file.path, {
        imports: extracted.imports,
      });
      callEdges = buildCallEdgesFromRefs(refs, extracted);
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
    rendersEdges = renders.map((render) => {
      const parent = extracted.components.find(component => component.name === render.parentName);
      const edge = {
        parentId: render.fromId ?? parent?.id ?? '',
        childId: render.toId ?? '',
        line: render.line,
      };
      if (render.childFilePath) {
        edgeResolutionHints.set(edge, {
          from: { labels: ['Component'], filePath: render.parentFilePath, name: render.parentName },
          to: {
            labels: ['Component'],
            filePath: render.childFilePath,
            name: render.childName,
            exportedOnly: render.childFilePath !== render.parentFilePath,
          },
        });
      }
      return edge;
    });
  }

  // --- TypeRefs / HAS_PARAM / RETURNS / USES_TYPE, re-resolved through the barrel chain ---
  // `extracted` was built by extractEntitiesForFile() before resolvedImportMap
  // existed (that call happens earlier in the parse pipeline, without barrel
  // knowledge), so its typeRefs key every cross-file type reference on the
  // barrel it was imported through, not the file that actually declares it.
  // When resolvedImportMap is available, re-run extractAllEntities with it so
  // these four fields reflect barrel-resolved origins; every other field
  // (functions, classes, imports, ...) still comes from the original
  // `extracted`, unchanged, so this only touches type-relationship edges.
  let typeRefs = extracted.typeRefs ?? [];
  let hasParamEdges = extracted.hasParamEdges ?? [];
  let returnsEdges = extracted.returnsEdges ?? [];
  let usesTypeEdges = extracted.usesTypeEdges ?? [];
  if (resolvedImportMap && resolvedImportMap.size > 0 && rootNode) {
    const reResolved = extractAllEntities(rootNode, file.path, resolvedImportMap);
    typeRefs = reResolved.typeRefs ?? [];
    hasParamEdges = reResolved.hasParamEdges ?? [];
    returnsEdges = reResolved.returnsEdges ?? [];
    usesTypeEdges = reResolved.usesTypeEdges ?? [];
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
    hasMethodEdges: extracted.hasMethodEdges ?? [],
    hasPropertyEdges: extracted.hasPropertyEdges ?? [],
    typeRefs,
    hasParamEdges,
    returnsEdges,
    usesTypeEdges,
    exportsEdges,
    importsSymbolEdges,
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
    parsed.rendersEdges.length +
    parsed.hasMethodEdges.length +
    parsed.hasPropertyEdges.length +
    parsed.hasParamEdges.length +
    parsed.returnsEdges.length +
    parsed.usesTypeEdges.length +
    parsed.exportsEdges.length +
    parsed.importsSymbolEdges.length
  );
}
