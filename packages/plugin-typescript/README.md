# @codegraph/plugin-typescript

TypeScript/JavaScript/React language plugin for CodeGraph. Provides grammar lookup and entity extraction for TS/JS/React files using tree-sitter-typescript.

## Supported Extensions

`.ts`, `.tsx`, `.js`, `.jsx`, `.mts`, `.cts`, `.mjs`, `.cjs`

Uses the `typescript` grammar for `.ts`, `.mts`, `.cts`, `.js`, `.mjs`, `.cjs` and the `tsx` grammar for `.tsx`, `.jsx`.

## Extracted Entities

- **Functions**: Regular functions, arrow functions, methods, async functions
- **Classes**: Class declarations with inheritance and abstract detection
- **Interfaces**: Interface declarations with extends
- **Types**: Type alias declarations
- **Variables**: const, let, var declarations at module level
- **Components**: React/JSX component detection
- **Imports**: ES module imports (default, named, namespace)
- **Exports**: Direct exports, default exports, named aliases, and barrel re-export chains

## Extracted Relationships

- **CALLS**: Function-to-function call references
- **IMPORTS**: Import source resolution
- **IMPORTS_SYMBOL / EXPORTS**: Symbol-level import and export attribution, including barrel origins and aliases
- **RENDERS**: JSX component render references
- **EXTENDS**: Class/interface inheritance
- **IMPLEMENTS**: Interface implementation
- **HAS_PARAM / RETURNS / USES_TYPE**: Parameter, return, annotation, instantiation, and cast type edges

Call attribution resolves aliases, imported symbols, barrel origins, and typed receivers where source evidence identifies a unique target. Unresolved external calls are omitted by default rather than attached to guessed symbols.

## Complexity Metrics

Re-exports universal complexity analysis from `@codegraph/plugin-common`:
- Cyclomatic complexity
- Cognitive complexity
- Nesting depth
- Complexity classification (low/medium/high/critical)

## API

```ts
import { typescriptPlugin } from '@codegraph/plugin-typescript';

// Plugin object (implements LanguagePlugin interface)
typescriptPlugin.extractAllEntities(root, filePath);
typescriptPlugin.getGrammarForExtension('.tsx');

// Individual extractors
import {
  extractFunctions,
  extractClasses,
  extractInterfaces,
  extractTypes,
  extractVariables,
  extractComponents,
  extractImports,
  extractCalls,
  extractRenders,
  extractInheritance,
} from '@codegraph/plugin-typescript';
```

## Grammar

Uses `tree-sitter-typescript` which provides both `typescript` and `tsx` language grammars. The correct grammar is selected automatically based on file extension.
