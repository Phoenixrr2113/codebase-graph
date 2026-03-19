# @codegraph/plugin-typescript

TypeScript/JavaScript/React language plugin for CodeGraph. Provides grammar lookup and entity extraction for TS/JS/React files using tree-sitter-typescript.

## Supported Extensions

`.ts`, `.tsx`, `.js`, `.jsx`, `.mts`, `.cts`, `.mjs`, `.cjs`

Uses the `typescript` grammar for `.ts`, `.mts`, `.cts`, `.js`, `.mjs`, `.cjs` and the `tsx` grammar for `.tsx`, `.jsx`.

## Extracted Entities

- **Functions** -- Regular functions, arrow functions, methods, async functions
- **Classes** -- Class declarations with inheritance and abstract detection
- **Interfaces** -- Interface declarations with extends
- **Types** -- Type alias declarations
- **Variables** -- const, let, var declarations at module level
- **Components** -- React/JSX component detection
- **Imports** -- ES module imports (default, named, namespace)

## Extracted Relationships

- **CALLS** -- Function-to-function call references
- **IMPORTS** -- Import source resolution
- **RENDERS** -- JSX component render references
- **EXTENDS** -- Class/interface inheritance
- **IMPLEMENTS** -- Interface implementation

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
