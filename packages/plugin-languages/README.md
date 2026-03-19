# @codegraph/plugin-languages

Registry of 37 language configurations (3 tier-1 + 34 tier-2) for CodeGraph, using the `@codegraph/plugin-generic` factory. Grammars are lazily loaded from optional dependencies -- only installed grammars become available, missing ones are silently skipped.

## API

### `registerAllLanguages(registry)`

Registers all languages whose tree-sitter grammars are installed. Returns `{ registered: string[], skipped: string[] }`.

### `registerLanguage(registry, languageId)`

Registers a single language by ID. Returns `true` if the grammar was available, `false` otherwise.

### `getAllLanguageConfigs()`

Returns metadata for all configured languages (id, displayName, extensions, grammarPackage) without loading grammars.

### `loadGrammar(packageName)` / `clearGrammarCache()`

Low-level grammar loading with caching.

## Supported Languages

### Tier-1 (required dependencies)

| Language | ID | Extensions |
|---|---|---|
| Java | `java` | `.java` |
| C# | `csharp` | `.cs` |
| PHP | `php` | `.php` |

### Batch 1: High-demand

| Language | ID | Extensions |
|---|---|---|
| Ruby | `ruby` | `.rb`, `.rake`, `.gemspec` |
| Kotlin | `kotlin` | `.kt`, `.kts` |
| Swift | `swift` | `.swift` |
| Scala | `scala` | `.scala`, `.sc` |
| Dart | `dart` | `.dart` |

### Batch 2: Systems

| Language | ID | Extensions |
|---|---|---|
| C | `c` | `.c`, `.h` |
| C++ | `cpp` | `.cpp`, `.cc`, `.cxx`, `.hpp`, `.hxx`, `.h` |
| Objective-C | `objective-c` | `.m`, `.mm` |

### Batch 3: Scripting

| Language | ID | Extensions |
|---|---|---|
| Lua | `lua` | `.lua` |
| Elixir | `elixir` | `.ex`, `.exs` |
| Erlang | `erlang` | `.erl`, `.hrl` |
| R | `r` | `.r`, `.R` |
| Haskell | `haskell` | `.hs` |
| Perl | `perl` | `.pl`, `.pm` |
| Julia | `julia` | `.jl` |
| Clojure | `clojure` | `.clj`, `.cljs`, `.cljc` |

### Batch 4: Shell/Config

| Language | ID | Extensions |
|---|---|---|
| Bash | `bash` | `.sh`, `.bash` |
| PowerShell | `powershell` | `.ps1`, `.psm1`, `.psd1` |
| SQL | `sql` | `.sql` |
| HCL | `hcl` | `.hcl`, `.tf` |

### Batch 5: Markup/Data

| Language | ID | Extensions |
|---|---|---|
| YAML | `yaml` | `.yml`, `.yaml` |
| TOML | `toml` | `.toml` |
| HTML | `html` | `.html`, `.htm` |
| CSS | `css` | `.css` |
| JSON | `json` | `.json` |
| Dockerfile | `dockerfile` | `Dockerfile` |

### Batch 6: Niche

| Language | ID | Extensions |
|---|---|---|
| OCaml | `ocaml` | `.ml`, `.mli` |
| F# | `fsharp` | `.fs`, `.fsi`, `.fsx` |
| Zig | `zig` | `.zig` |
| Nim | `nim` | `.nim` |
| Crystal | `crystal` | `.cr` |
| Groovy | `groovy` | `.groovy`, `.gradle` |
| Verilog | `verilog` | `.v`, `.sv` |
| Protobuf | `protobuf` | `.proto` |

## Lazy Loading

Grammars are installed as optional dependencies (`optionalDependencies` in package.json). At registration time, each grammar package is dynamically imported. If the import fails (package not installed), the language is skipped without errors. This keeps the install size small -- users only pay for grammars they need.

## Usage

```ts
import { registerAllLanguages } from '@codegraph/plugin-languages';

const result = await registerAllLanguages(registry);
console.log(`Registered: ${result.registered.length}, Skipped: ${result.skipped.length}`);
```
