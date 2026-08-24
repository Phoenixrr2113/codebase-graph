# @codegraph/plugin-go

Go language plugin for CodeGraph. Extracts code entities from Go source files using tree-sitter-go.

## Supported Extensions

`.go`

## Entity Mapping

Go concepts are mapped to the unified CodeGraph schema:

| Go Concept | CodeGraph Entity |
|---|---|
| `struct` | ClassEntity |
| `interface` | InterfaceEntity |
| `func` (top-level) | FunctionEntity |
| method (with receiver) | FunctionEntity (receiver encoded in ID) |
| `var` | VariableEntity (kind: `let`) |
| `const` | VariableEntity (kind: `const`) |
| `import` | ImportEntity |
| `type` alias/definition | TypeEntity |

## Extracted Features

- **Functions & Methods**: Parameters with types, return types, doc comments, complexity metrics. Methods include receiver type extraction (e.g., `func (s *Server) Start()` records receiver as `Server`).
- **Structs**: Embedded types detected as `implements` relationships. Doc comments extracted.
- **Interfaces**: Embedded interfaces detected as `extends` relationships. Type constraint elements recognized.
- **Variables**: Grouped `var`/`const` declarations supported. Type annotations preserved.
- **Imports**: Single and grouped imports. Aliases, dot imports, and blank imports handled. Package name extracted from import path.
- **Types**: Type aliases and type definitions (excludes structs/interfaces handled separately).
- **Calls**: Function and method calls within function bodies. Filters Go builtins (`append`, `len`, `make`, `panic`, etc.) and common stdlib functions. Only same-file calls resolve. Cross-package and same-package cross-file calls stay unresolved because the per-file extractor does not have the package-wide symbol catalog needed to attribute them safely.

## Export Detection

Uses Go's uppercase naming convention: identifiers starting with an uppercase letter are exported, others are unexported.

## Architecture

Uses the `@codegraph/plugin-generic` factory with custom override extractors for all entity types. The plugin is exported as `goPlugin`.

## API

```ts
import { goPlugin } from '@codegraph/plugin-go';

goPlugin.extractAllEntities(root, filePath);

// Individual extractors
import {
  extractFunctions,
  extractClasses,
  extractInterfaces,
  extractVariables,
  extractImports,
  extractTypes,
  extractCalls,
  extractInheritance,
} from '@codegraph/plugin-go';
```

## Grammar

Uses `tree-sitter-go`.
