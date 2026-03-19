# @codegraph/plugin-python

Python language plugin for CodeGraph. Extracts code entities from Python source files using tree-sitter-python.

## Supported Extensions

`.py`, `.pyw`, `.pyi`

## Extracted Entities

- **Functions** -- `def` and `async def` declarations with:
  - Type annotations (parameters and return types)
  - Docstrings (triple-quoted strings as first body statement)
  - Async detection
  - Method detection (inside class bodies)
  - Complexity metrics (cyclomatic, cognitive, nesting depth)
  - `self`/`cls` parameters filtered out automatically
- **Classes** -- `class` declarations with:
  - Superclass extraction from argument list
  - Docstrings
  - Method enumeration
  - Export detection via `_` prefix convention
- **Variables** -- Top-level assignments with:
  - Constant detection (`UPPER_CASE` naming)
  - Basic type inference from right-hand side
- **Imports** -- `import` and `from ... import` statements with:
  - Named specifiers and aliases (`import X as Y`)
  - Namespace vs named import distinction
  - Python import path resolution (relative and absolute)

## Extracted Relationships

- **CALLS** -- Function-to-function call references (filters Python builtins: `print`, `len`, `range`, `isinstance`, etc.)
- **Inheritance** -- Derived from class `extends` fields

## Architecture

Uses the `@codegraph/plugin-generic` factory with custom override extractors for Python-specific behavior (docstrings, type annotations, parameter filtering, import resolution). The plugin is exported as `pythonPlugin`.

## API

```ts
import { pythonPlugin } from '@codegraph/plugin-python';

pythonPlugin.extractAllEntities(root, filePath);

// Individual extractors
import {
  extractFunctions,
  extractClasses,
  extractVariables,
  extractImports,
  extractCalls,
  extractInheritance,
  resolvePythonImport,
} from '@codegraph/plugin-python';
```

## Grammar

Uses `tree-sitter-python`.
