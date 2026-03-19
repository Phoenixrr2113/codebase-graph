# @codegraph/plugin-generic

Config-driven language plugin factory for CodeGraph. Takes a declarative language configuration and returns a fully-formed `LanguagePlugin`, reducing per-language plugin code from ~500-1000 lines to ~100-150 lines of config.

## API

### `createLanguagePlugin(config: GenericLanguageConfig): LanguagePlugin`

The factory:
1. Sets up grammar helpers (extension-to-grammar mapping)
2. Wires up standard or overridden extractors (with Phase 2 configs)
3. Composes `extractAllEntities` from individual extractors
4. Returns a `LanguagePlugin` conforming to the `@codegraph/types` interface

### `GenericLanguageConfig`

Core fields:
- `id` / `displayName` / `extensions` -- Language identity
- `grammar` -- Tree-sitter grammar object
- `grammarPackage` -- Optional package name for lazy loading
- `nodeTypes` -- Maps entity types to tree-sitter node type names:
  - `functions`, `classes`, `interfaces`, `variables`, `imports`, `types`, `calls`
- `fields` -- Customizable field name mappings (`name`, `parameters`, `returnType`, `body`, `superclass`, `callee`)

### Phase 2 Features

Declarative configs for language-specific behavior without writing custom extractors:

- **`ImportConfig`** (Phase 2a) -- Structured import extraction: module field/node types, specifier extraction, alias handling, namespace detection, quote stripping.
- **`ParamConfig`** (Phase 2b) -- Rich parameter extraction: typed parameters, default values, name filtering (`self`, `cls`, `this`), custom identifier node types.
- **`DocstringConfig`** (Phase 2c) -- Documentation extraction strategies: `'preceding-comment'` (Java/Go/Rust style), `'body-first-string'` (Python style), `'attribute'`, or `'none'`.
- **`VisibilityConfig`** (Phase 2d) -- Export/visibility detection strategies: `'modifier'` (pub/public keywords), `'naming'` (Go uppercase, Python `_` prefix), `'keyword'` (JS export), or `'all-public'`. Also supports async and abstract modifier detection.

### Override Callbacks

The `overrides` field allows replacing any generic extractor with a custom implementation:
- `extractFunctions`, `extractClasses`, `extractInterfaces`, `extractVariables`, `extractImports`, `extractTypes`, `extractCalls`, `extractInheritance`
- Lightweight overrides: `isExported`, `isAsync`, `isAbstract`, `extractDocstring`, `extractParameters`, `extractReturnType`, `extractClassName`, `extractSuperclasses`
- `builtinFunctions` -- Set of names to skip in call extraction

## Usage

Tier-2 languages use this factory directly with config-only definitions:

```ts
import { createLanguagePlugin } from '@codegraph/plugin-generic';

export const rubyPlugin = createLanguagePlugin({
  id: 'ruby',
  displayName: 'Ruby',
  extensions: ['.rb', '.rake', '.gemspec'],
  grammar: RubyGrammar,
  nodeTypes: {
    functions: ['method', 'singleton_method'],
    classes: ['class'],
    imports: ['call'],  // require/require_relative
    calls: ['call', 'method_call'],
  },
});
```

Tier-1 languages (Python, Go, Rust) use the factory with custom override extractors for full-fidelity extraction.
