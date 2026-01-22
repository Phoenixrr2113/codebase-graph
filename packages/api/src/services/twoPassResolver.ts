/**
 * Two-Pass Relationship Resolution
 * Ensures all symbols exist before resolving cross-file relationships
 * Based on CodeGraph v2 Specification
 */

import { createLogger, traced } from '@codegraph/logger';
import type { ParsedFileEntities } from '@codegraph/graph';
import type { FunctionEntity, ClassEntity } from '@codegraph/types';

const logger = createLogger({ namespace: 'API:TwoPassResolver' });

// ============================================================================
// Types
// ============================================================================

/** Extracted symbol info for cross-file resolution */
export interface SymbolInfo {
  /** Symbol name */
  name: string;
  /** File containing the symbol */
  file: string;
  /** Symbol type (function, class, etc.) */
  type: 'function' | 'class' | 'interface' | 'variable' | 'type';
  /** Whether symbol is exported */
  isExported: boolean;
  /** Start line of the symbol */
  startLine: number;
}

/** Unresolved call reference */
export interface UnresolvedCall {
  /** Caller function name */
  callerName: string;
  /** Caller file */
  callerFile: string;
  /** Target function name */
  targetName: string;
  /** Line number of call */
  line: number;
}

/** Result of relationship resolution */
export interface ResolutionResult {
  /** Total symbols collected in pass 1 */
  totalSymbols: number;
  /** Total relationships resolved in pass 2 */
  resolvedRelationships: number;
  /** Unresolved references (cross-file) */
  unresolvedReferences: number;
  /** Symbols by file */
  symbolsByFile: Map<string, SymbolInfo[]>;
}

/** Options for two-pass resolution */
export interface TwoPassOptions {
  /** Whether to resolve external dependencies */
  resolveExternals?: boolean;
  /** Maximum depth for transitive resolution */
  maxDepth?: number;
}

// ============================================================================
// Symbol Registry
// ============================================================================

/**
 * Registry for tracking all symbols across files
 * Used in pass 1 to collect, pass 2 to resolve
 */
export class SymbolRegistry {
  /** All symbols by name (may have duplicates across files) */
  private symbolsByName = new Map<string, SymbolInfo[]>();
  /** Symbols indexed by file path */
  private symbolsByFile = new Map<string, SymbolInfo[]>();
  /** Exports by file (for import resolution) */
  private exportsByFile = new Map<string, Map<string, SymbolInfo>>();

  /**
   * Register a symbol from extraction
   */
  registerSymbol(symbol: SymbolInfo): void {
    // Index by name
    const byName = this.symbolsByName.get(symbol.name) || [];
    byName.push(symbol);
    this.symbolsByName.set(symbol.name, byName);

    // Index by file
    const byFile = this.symbolsByFile.get(symbol.file) || [];
    byFile.push(symbol);
    this.symbolsByFile.set(symbol.file, byFile);

    // Track exports
    if (symbol.isExported) {
      const fileExports = this.exportsByFile.get(symbol.file) || new Map();
      fileExports.set(symbol.name, symbol);
      this.exportsByFile.set(symbol.file, fileExports);
    }
  }

  /**
   * Register all functions from a parsed file
   */
  registerFunctions(filePath: string, functions: FunctionEntity[]): void {
    for (const fn of functions) {
      this.registerSymbol({
        name: fn.name,
        file: filePath,
        type: 'function',
        isExported: fn.isExported,
        startLine: fn.startLine,
      });
    }
  }

  /**
   * Register all classes from a parsed file
   */
  registerClasses(filePath: string, classes: ClassEntity[]): void {
    for (const cls of classes) {
      this.registerSymbol({
        name: cls.name,
        file: filePath,
        type: 'class',
        isExported: cls.isExported,
        startLine: cls.startLine,
      });
    }
  }

  /**
   * Find a symbol by name
   * Returns all matching symbols (may be in different files)
   */
  findSymbolByName(name: string): SymbolInfo[] {
    return this.symbolsByName.get(name) || [];
  }

  /**
   * Find an exported symbol from a specific file
   */
  findExport(filePath: string, symbolName: string): SymbolInfo | undefined {
    return this.exportsByFile.get(filePath)?.get(symbolName);
  }

  /**
   * Get all symbols in a file
   */
  getFileSymbols(filePath: string): SymbolInfo[] {
    return this.symbolsByFile.get(filePath) || [];
  }

  /**
   * Get all files with symbols
   */
  getAllFiles(): string[] {
    return [...this.symbolsByFile.keys()];
  }

  /**
   * Get total symbol count
   */
  getSymbolCount(): number {
    let count = 0;
    for (const symbols of this.symbolsByFile.values()) {
      count += symbols.length;
    }
    return count;
  }

  /**
   * Clear the registry
   */
  clear(): void {
    this.symbolsByName.clear();
    this.symbolsByFile.clear();
    this.exportsByFile.clear();
  }
}

// ============================================================================
// Two-Pass Resolution Functions
// ============================================================================

/**
 * Pass 1: Collect all symbols from parsed files
 * Creates nodes in graph but defers relationship creation
 */
export const collectSymbols = traced('collectSymbols', function collectSymbols(
  parsedFiles: ParsedFileEntities[],
  registry: SymbolRegistry
): number {
  let symbolCount = 0;

  for (const parsed of parsedFiles) {
    const filePath = parsed.file.path;

    // Register functions
    if (parsed.functions) {
      registry.registerFunctions(filePath, parsed.functions);
      symbolCount += parsed.functions.length;
    }

    // Register classes
    if (parsed.classes) {
      registry.registerClasses(filePath, parsed.classes);
      symbolCount += parsed.classes.length;
    }

    // Register interfaces (as type)
    if (parsed.interfaces) {
      for (const iface of parsed.interfaces) {
        registry.registerSymbol({
          name: iface.name,
          file: filePath,
          type: 'interface',
          isExported: iface.isExported,
          startLine: iface.startLine,
        });
        symbolCount++;
      }
    }

    // Register types
    if (parsed.types) {
      for (const type of parsed.types) {
        registry.registerSymbol({
          name: type.name,
          file: filePath,
          type: 'type',
          isExported: type.isExported,
          startLine: type.startLine,
        });
        symbolCount++;
      }
    }

    // Register variables
    if (parsed.variables) {
      for (const variable of parsed.variables) {
        registry.registerSymbol({
          name: variable.name,
          file: filePath,
          type: 'variable',
          isExported: variable.isExported,
          startLine: variable.line,
        });
        symbolCount++;
      }
    }
  }

  logger.info(`Pass 1 complete: collected ${symbolCount} symbols from ${parsedFiles.length} files`);
  return symbolCount;
});

/**
 * Pass 2: Resolve relationships using the symbol registry
 * Now that all symbols are known, we can resolve cross-file references
 */
export const resolveRelationships = traced('resolveRelationships', function resolveRelationships(
  parsedFiles: ParsedFileEntities[],
  registry: SymbolRegistry,
  _options: TwoPassOptions = {}
): { resolved: number; unresolved: number } {
  let resolved = 0;
  let unresolved = 0;

  for (const parsed of parsedFiles) {
    // Resolve CALLS targets
    if (parsed.callEdges) {
      for (const call of parsed.callEdges) {
        const targets = registry.findSymbolByName(call.calleeId);
        if (targets.length > 0) {
          resolved++;
        } else {
          // External or unresolved reference
          unresolved++;
        }
      }
    }

    // Resolve EXTENDS targets
    if (parsed.extendsEdges) {
      for (const ext of parsed.extendsEdges) {
        const targets = registry.findSymbolByName(ext.parentId);
        if (targets.length > 0) {
          resolved++;
        } else {
          unresolved++;
        }
      }
    }

    // Resolve IMPLEMENTS targets
    if (parsed.implementsEdges) {
      for (const impl of parsed.implementsEdges) {
        const targets = registry.findSymbolByName(impl.interfaceId);
        if (targets.length > 0) {
          resolved++;
        } else {
          unresolved++;
        }
      }
    }
  }

  logger.info(`Pass 2 complete: ${resolved} resolved, ${unresolved} unresolved references`);
  return { resolved, unresolved };
});

/**
 * Perform full two-pass resolution
 */
export const twoPassResolve = traced('twoPassResolve', function twoPassResolve(
  parsedFiles: ParsedFileEntities[],
  options: TwoPassOptions = {}
): ResolutionResult {
  const registry = new SymbolRegistry();

  // Pass 1: Collect all symbols
  const totalSymbols = collectSymbols(parsedFiles, registry);

  // Pass 2: Resolve relationships
  const { resolved, unresolved } = resolveRelationships(parsedFiles, registry, options);

  return {
    totalSymbols,
    resolvedRelationships: resolved,
    unresolvedReferences: unresolved,
    symbolsByFile: new Map(
      registry.getAllFiles().map(file => [file, registry.getFileSymbols(file)])
    ),
  };
});

// ============================================================================
// Utility Functions
// ============================================================================

/**
 * Check if a symbol name is likely a built-in
 */
export function isBuiltIn(name: string): boolean {
  const builtIns = new Set([
    'console', 'Math', 'JSON', 'Object', 'Array', 'String', 'Number',
    'Boolean', 'Date', 'Promise', 'Map', 'Set', 'RegExp', 'Error',
    'parseInt', 'parseFloat', 'setTimeout', 'setInterval', 'clearTimeout',
    'fetch', 'require', 'module', 'exports', '__dirname', '__filename',
  ]);
  return builtIns.has(name);
}

/**
 * Get resolution summary string
 */
export function getResolutionSummary(result: ResolutionResult): string {
  return [
    `Symbols: ${result.totalSymbols}`,
    `Resolved: ${result.resolvedRelationships}`,
    `Unresolved: ${result.unresolvedReferences}`,
    `Files: ${result.symbolsByFile.size}`,
  ].join(', ');
}
