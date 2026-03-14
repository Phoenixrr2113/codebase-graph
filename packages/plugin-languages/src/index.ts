/**
 * @codegraph/plugin-languages — Tier-2 Language Plugin Registry
 *
 * Provides config-only definitions for 27+ languages beyond the core 7 tier-1 plugins.
 * Grammars are lazily loaded from optionalDependencies — only installed grammars
 * become available. Languages whose grammars fail to load are silently skipped.
 *
 * Usage:
 *   import { registerAllLanguages } from '@codegraph/plugin-languages';
 *   await registerAllLanguages(languageRegistry);
 */

import { createLanguagePlugin, type GenericLanguageConfig } from '@codegraph/plugin-generic';
import type { LanguagePlugin } from '@codegraph/types';
import { loadGrammar, clearGrammarCache } from './grammar-loader';

// Import all language configs

// Batch 1: High-demand
import { rubyConfig } from './configs/ruby';
import { kotlinConfig } from './configs/kotlin';
import { swiftConfig } from './configs/swift';
import { scalaConfig } from './configs/scala';
import { dartConfig } from './configs/dart';

// Batch 2: Systems languages
import { cConfig } from './configs/c';
import { cppConfig } from './configs/cpp';
import { objectiveCConfig } from './configs/objective-c';

// Batch 3: Scripting
import { luaConfig } from './configs/lua';
import { elixirConfig } from './configs/elixir';
import { erlangConfig } from './configs/erlang';
import { rConfig } from './configs/r';
import { haskellConfig } from './configs/haskell';
import { perlConfig } from './configs/perl';
import { juliaConfig } from './configs/julia';
import { clojureConfig } from './configs/clojure';

// Batch 4: Shell/Config
import { bashConfig } from './configs/bash';
import { powershellConfig } from './configs/powershell';
import { sqlConfig } from './configs/sql';
import { hclConfig } from './configs/hcl';

// Batch 5: Markup/Data
import { yamlConfig } from './configs/yaml';
import { tomlConfig } from './configs/toml';
import { htmlConfig } from './configs/html';
import { cssConfig } from './configs/css';
import { jsonConfig } from './configs/json';
import { dockerfileConfig } from './configs/dockerfile';

// Batch 6: Niche
import { ocamlConfig } from './configs/ocaml';
import { fsharpConfig } from './configs/fsharp';
import { zigConfig } from './configs/zig';
import { nimConfig } from './configs/nim';
import { crystalConfig } from './configs/crystal';
import { groovyConfig } from './configs/groovy';
import { verilogConfig } from './configs/verilog';
import { protobufConfig } from './configs/protobuf';

// ============================================================================
// All Language Configs with Grammar Package Mappings
// ============================================================================

interface LanguageEntry {
  config: Omit<GenericLanguageConfig, 'grammar'>;
  grammarPackage: string;
}

/**
 * All tier-2 language configurations.
 * Each maps a config to its tree-sitter grammar npm package.
 */
export const allLanguageEntries: LanguageEntry[] = [
  // Batch 1: High-demand
  { config: rubyConfig, grammarPackage: 'tree-sitter-ruby' },
  { config: kotlinConfig, grammarPackage: 'tree-sitter-kotlin' },
  { config: swiftConfig, grammarPackage: 'tree-sitter-swift' },
  { config: scalaConfig, grammarPackage: 'tree-sitter-scala' },
  { config: dartConfig, grammarPackage: 'tree-sitter-dart' },

  // Batch 2: Systems languages
  { config: cConfig, grammarPackage: 'tree-sitter-c' },
  { config: cppConfig, grammarPackage: 'tree-sitter-cpp' },
  { config: objectiveCConfig, grammarPackage: 'tree-sitter-objc' },

  // Batch 3: Scripting
  { config: luaConfig, grammarPackage: 'tree-sitter-lua' },
  { config: elixirConfig, grammarPackage: 'tree-sitter-elixir' },
  { config: erlangConfig, grammarPackage: 'tree-sitter-erlang' },
  { config: rConfig, grammarPackage: 'tree-sitter-r' },
  { config: haskellConfig, grammarPackage: 'tree-sitter-haskell' },
  { config: perlConfig, grammarPackage: 'tree-sitter-perl' },
  { config: juliaConfig, grammarPackage: 'tree-sitter-julia' },
  { config: clojureConfig, grammarPackage: 'tree-sitter-clojure' },

  // Batch 4: Shell/Config
  { config: bashConfig, grammarPackage: 'tree-sitter-bash' },
  { config: powershellConfig, grammarPackage: 'tree-sitter-powershell' },
  { config: sqlConfig, grammarPackage: 'tree-sitter-sql' },
  { config: hclConfig, grammarPackage: 'tree-sitter-hcl' },

  // Batch 5: Markup/Data
  { config: yamlConfig, grammarPackage: 'tree-sitter-yaml' },
  { config: tomlConfig, grammarPackage: 'tree-sitter-toml-v1' },
  { config: htmlConfig, grammarPackage: 'tree-sitter-html' },
  { config: cssConfig, grammarPackage: 'tree-sitter-css' },
  { config: jsonConfig, grammarPackage: 'tree-sitter-json' },
  { config: dockerfileConfig, grammarPackage: 'tree-sitter-dockerfile' },

  // Batch 6: Niche
  { config: ocamlConfig, grammarPackage: 'tree-sitter-ocaml' },
  { config: fsharpConfig, grammarPackage: 'tree-sitter-fsharp' },
  { config: zigConfig, grammarPackage: 'tree-sitter-zig' },
  { config: nimConfig, grammarPackage: 'tree-sitter-nim' },
  { config: crystalConfig, grammarPackage: 'tree-sitter-crystal' },
  { config: groovyConfig, grammarPackage: 'tree-sitter-groovy' },
  { config: verilogConfig, grammarPackage: 'tree-sitter-verilog' },
  { config: protobufConfig, grammarPackage: 'tree-sitter-protobuf' },
];

// ============================================================================
// Registry Interface
// ============================================================================

/**
 * Minimal registry interface for registering plugins.
 * Matches the LanguageRegistry from @codegraph/core's pipeline/registry.
 */
interface PluginRegistry {
  register(plugin: LanguagePlugin): void;
}

// ============================================================================
// Public API
// ============================================================================

/**
 * Register all tier-2 languages whose grammars are installed.
 * Loads grammars lazily — only installed optionalDependencies work.
 * Languages with missing grammars are silently skipped.
 *
 * @param registry - The language registry to register plugins with
 * @returns Object with counts and list of registered/skipped languages
 */
export async function registerAllLanguages(registry: PluginRegistry): Promise<{
  registered: string[];
  skipped: string[];
}> {
  const registered: string[] = [];
  const skipped: string[] = [];

  for (const entry of allLanguageEntries) {
    const grammar = await loadGrammar(entry.grammarPackage);

    if (grammar) {
      const fullConfig: GenericLanguageConfig = {
        ...(entry.config as GenericLanguageConfig),
        grammar,
        grammarPackage: entry.grammarPackage,
      };

      const plugin = createLanguagePlugin(fullConfig);
      registry.register(plugin);
      registered.push(entry.config.id);
    } else {
      skipped.push(entry.config.id);
    }
  }

  return { registered, skipped };
}

/**
 * Get all available language configs (without grammars loaded).
 * Useful for checking what languages could be supported.
 */
export function getAllLanguageConfigs(): Array<{ id: string; displayName: string; extensions: string[]; grammarPackage: string }> {
  return allLanguageEntries.map(entry => ({
    id: entry.config.id,
    displayName: entry.config.displayName,
    extensions: entry.config.extensions,
    grammarPackage: entry.grammarPackage,
  }));
}

/**
 * Register a single language by ID if its grammar is installed.
 *
 * @param registry - The language registry
 * @param languageId - Language ID (e.g., 'ruby')
 * @returns true if registered, false if grammar not available
 */
export async function registerLanguage(registry: PluginRegistry, languageId: string): Promise<boolean> {
  const entry = allLanguageEntries.find(e => e.config.id === languageId);
  if (!entry) return false;

  const grammar = await loadGrammar(entry.grammarPackage);
  if (!grammar) return false;

  const fullConfig: GenericLanguageConfig = {
    ...(entry.config as GenericLanguageConfig),
    grammar,
    grammarPackage: entry.grammarPackage,
  };

  const plugin = createLanguagePlugin(fullConfig);
  registry.register(plugin);
  return true;
}

// Re-export for consumers
export { loadGrammar, clearGrammarCache } from './grammar-loader';
export type { GenericLanguageConfig } from '@codegraph/plugin-generic';

// Re-export individual configs for custom use
export { rubyConfig } from './configs/ruby';
export { kotlinConfig } from './configs/kotlin';
export { swiftConfig } from './configs/swift';
export { scalaConfig } from './configs/scala';
export { dartConfig } from './configs/dart';
export { cConfig } from './configs/c';
export { cppConfig } from './configs/cpp';
export { objectiveCConfig } from './configs/objective-c';
export { luaConfig } from './configs/lua';
export { elixirConfig } from './configs/elixir';
export { erlangConfig } from './configs/erlang';
export { rConfig } from './configs/r';
export { haskellConfig } from './configs/haskell';
export { perlConfig } from './configs/perl';
export { juliaConfig } from './configs/julia';
export { clojureConfig } from './configs/clojure';
export { bashConfig } from './configs/bash';
export { powershellConfig } from './configs/powershell';
export { sqlConfig } from './configs/sql';
export { hclConfig } from './configs/hcl';
export { yamlConfig } from './configs/yaml';
export { tomlConfig } from './configs/toml';
export { htmlConfig } from './configs/html';
export { cssConfig } from './configs/css';
export { jsonConfig } from './configs/json';
export { dockerfileConfig } from './configs/dockerfile';
export { ocamlConfig } from './configs/ocaml';
export { fsharpConfig } from './configs/fsharp';
export { zigConfig } from './configs/zig';
export { nimConfig } from './configs/nim';
export { crystalConfig } from './configs/crystal';
export { groovyConfig } from './configs/groovy';
export { verilogConfig } from './configs/verilog';
export { protobufConfig } from './configs/protobuf';
