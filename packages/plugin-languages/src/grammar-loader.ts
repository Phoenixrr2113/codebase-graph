/**
 * Lazy Grammar Loader
 *
 * Dynamically imports tree-sitter grammar packages on demand.
 * Grammars are cached after first load. If a grammar package is not
 * installed (optionalDependency), loadGrammar returns undefined
 * and the language becomes unavailable (no crash).
 */

/** Cache of loaded grammars by package name */
const grammarCache = new Map<string, unknown>();

/** Set of packages that failed to load (avoid retrying) */
const failedPackages = new Set<string>();

/**
 * Attempt to load a tree-sitter grammar package.
 *
 * @param packageName - npm package name (e.g., 'tree-sitter-ruby')
 * @returns The grammar object, or undefined if not installed
 */
export async function loadGrammar(packageName: string): Promise<unknown | undefined> {
  if (grammarCache.has(packageName)) {
    return grammarCache.get(packageName);
  }

  if (failedPackages.has(packageName)) {
    return undefined;
  }

  try {
    const mod = await import(packageName);
    const grammar = mod.default || mod;
    grammarCache.set(packageName, grammar);
    return grammar;
  } catch {
    failedPackages.add(packageName);
    return undefined;
  }
}

/**
 * Synchronously get a grammar that was previously loaded.
 * Returns undefined if not yet loaded.
 */
export function getLoadedGrammar(packageName: string): unknown | undefined {
  return grammarCache.get(packageName);
}

/**
 * Check if a grammar package is available (installed and loadable).
 */
export async function isGrammarAvailable(packageName: string): Promise<boolean> {
  const grammar = await loadGrammar(packageName);
  return grammar !== undefined;
}

/**
 * Clear the grammar cache (for testing).
 */
export function clearGrammarCache(): void {
  grammarCache.clear();
  failedPackages.clear();
}
