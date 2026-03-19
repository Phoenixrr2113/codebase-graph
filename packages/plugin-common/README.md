# @codegraph/plugin-common

Shared utilities for all CodeGraph language plugins. Eliminates duplicated AST traversal, ID generation, and grammar helper functions across 6+ language plugins.

## API

### Complexity Analysis

Language-agnostic complexity metrics computed via tree-sitter AST traversal. Covers TypeScript, Python, Java, Go, Rust, C#, PHP, and more through a unified node-type mapping.

- **`calculateComplexity(node)`** -- Returns all three metrics in a single AST walk:
  - `cyclomatic`: 1 + decision points + logical operators
  - `cognitive`: flow breaks + nesting-level penalties
  - `nestingDepth`: maximum nesting depth of control structures
- **`calculateCyclomatic(node)`** -- Cyclomatic complexity only.
- **`calculateCognitive(node)`** -- Cognitive complexity only.
- **`calculateNestingDepth(node)`** -- Max nesting depth only.
- **`classifyComplexity(metrics)`** -- Returns `'low' | 'medium' | 'high' | 'critical'` based on thresholds.
- **`COMPLEXITY_THRESHOLDS`** -- Configurable thresholds (cyclomatic: 10/20/50, cognitive: 15/30, nesting: 4/6).

Decision points recognized: `if`, `for`, `while`, `switch/match`, `catch/except`, ternary, logical operators (`&&`, `||`, `??`, `and`, `or`), plus language-specific variants for Rust expressions, Go select/defer, Python `elif`/`with`, and Java/C# switch labels.

### AST Helpers

- **`findNodesOfType(root, types)`** -- Recursively finds all AST nodes matching the given type names. Used by every language plugin for entity extraction.

### Entity ID Generation

- **`generateEntityId(filePath, type, name, line)`** -- Deterministic entity ID in the format `filePath:type:name:line`.

### Grammar Helpers

- **`createGrammarHelpers(extensionToGrammar)`** -- Creates grammar lookup helpers from an extension-to-grammar mapping. Returns:
  - `getGrammarForExtension(ext)` -- Lookup grammar by file extension.
  - `getSupportedExtensions()` -- List all supported extensions.
  - `isSupported(ext)` -- Check if an extension is supported.

## Types

- `ComplexityMetrics` -- `{ cyclomatic: number; cognitive: number; nestingDepth: number }`
- `GrammarHelpers` -- Return type of `createGrammarHelpers`

## Usage

```ts
import {
  calculateComplexity,
  findNodesOfType,
  generateEntityId,
  createGrammarHelpers,
} from '@codegraph/plugin-common';
```
