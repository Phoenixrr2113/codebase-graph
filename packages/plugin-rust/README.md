# @codegraph/plugin-rust

Rust language plugin for CodeGraph. Extracts code entities from Rust source files using tree-sitter-rust.

## Supported Extensions

`.rs`

## Entity Mapping

| Rust Concept | CodeGraph Entity |
|---|---|
| `struct` | ClassEntity |
| `trait` | InterfaceEntity |
| `fn` (top-level) | FunctionEntity |
| `impl` methods | FunctionEntity (impl type encoded in ID) |
| `const` | VariableEntity (kind: `const`) |
| `static` | VariableEntity (kind: `let`) |
| `use` | ImportEntity |
| `type` alias | TypeEntity (kind: `type`) |
| `enum` | TypeEntity (kind: `enum`) |
| `impl Trait for Struct` | InheritanceReference (implements) |
| `trait X: Y` | InheritanceReference (extends) |

## Extracted Features

- **Functions & Methods**: Parameters with types (including `self` parameter), return types, async detection via `function_modifiers`, doc comments (`///`), complexity metrics. Methods inside `impl` blocks have their impl type recorded in the entity ID.
- **Structs**: Visibility detection (`pub`), doc comments.
- **Traits**: Supertrait bounds extracted as `extends` relationships (e.g., `trait Handler: Send + Sync`). Visibility and doc comments.
- **Variables**: `const` and `static` items with type annotations.
- **Imports**: All `use` declaration forms: simple paths (`use std::io::Read`), grouped (`use std::io::{Read, Write}`), wildcards (`use std::io::*`), aliased (`use X as Y`), and single crate imports.
- **Types**: Type aliases and enums with visibility and doc comments.
- **Calls**: Function and method calls including direct (`helper()`), method (`self.method()`), and qualified (`Type::method()`). Cross-file targets resolve through declared modules and `crate::`, `self::`, or `super::` imports. External-crate and otherwise unresolvable targets are omitted instead of guessed. Rust builtins and common trait methods are filtered.
- **Inheritance**: `impl Trait for Type` creates implements edges. Trait supertrait bounds create extends edges.

## Visibility Detection

Checks for `visibility_modifier` child nodes (`pub`, `pub(crate)`, etc.).

## Architecture

Uses the `@codegraph/plugin-generic` factory with custom override extractors for all entity types. The plugin is exported as `rustPlugin`.

## API

```ts
import { rustPlugin } from '@codegraph/plugin-rust';

rustPlugin.extractAllEntities(root, filePath);

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
} from '@codegraph/plugin-rust';
```

## Grammar

Uses `tree-sitter-rust`.
