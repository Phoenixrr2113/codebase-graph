# @codegraph/types

Shared TypeScript type definitions for the CodeGraph monorepo. This package contains all entity, edge, graph, plugin, document, and NLP types used across packages. It has no runtime dependencies -- pure TypeScript declarations and constants.

## Installation

```
pnpm add @codegraph/types
```

## Build

```
pnpm build
```

## Type Categories

### Node Types (`nodes.ts`)

Entity types representing code constructs in the graph:

- **`FileEntity`** -- source file with path, LOC, hash, and optional embedding
- **`FunctionEntity`** -- function/method with params, return type, complexity metrics, body snippet
- **`ClassEntity`** -- class with export status, abstract flag, extends/implements
- **`InterfaceEntity`** -- interface with export status and extends
- **`VariableEntity`** -- variable with kind (`const`/`let`/`var`) and type annotation
- **`TypeEntity`** -- type alias or enum declaration
- **`ComponentEntity`** -- React component with props
- **`ImportEntity`** -- import statement with specifiers and resolved path
- **`CommitEntity`** -- git commit with hash, message, author, date
- **`ProjectEntity`** -- parsed project metadata

Base types: `BaseEntity`, `RangeEntity`, `ProvenanceFields`

Helper types: `FunctionParam`, `ComponentProp`, `ImportSpecifier`, `VariableKind`, `TypeKind`

Union types: `Entity` (all entity types), `NodeLabel` (all graph node labels)

### Edge Types (`edges.ts`)

Relationship types connecting nodes in the graph:

- **Structural:** `ContainsEdge` (file contains entity)
- **Import/Export:** `ImportsEdge`, `ImportsSymbolEdge`, `ExportsEdge`
- **Call graph:** `CallsEdge`, `InstantiatesEdge`
- **Inheritance:** `ExtendsEdge`, `ImplementsEdge`
- **Type usage:** `UsesTypeEdge`, `ReturnsEdge`, `HasParamEdge`
- **Class members:** `HasMethodEdge`, `HasPropertyEdge` (with `Visibility`)
- **React:** `RendersEdge`, `UsesHookEdge`
- **Git temporal:** `IntroducedInEdge`, `ModifiedInEdge`, `DeletedInEdge`
- **Dataflow:** `ReadsEdge`, `WritesEdge`, `FlowsToEdge`
- **Document:** `HasSectionEdge`, `ParentSectionEdge`, `ContainsCodeEdge`, `LinksToEdge`
- **Bridge:** `AboutEdge` (knowledge entity to code node, with confidence and method)

Union types: `Edge` (all edge types), `EdgeLabel` (all edge labels)

### Graph Types (`graph.ts`)

Types for graph operations and visualization:

- **Graph nodes:** `GraphNode` and typed variants (`FileGraphNode`, `FunctionGraphNode`, etc.)
- **Graph edges:** `GraphEdge` with source, target, label, and data
- **Graph data:** `GraphData`, `SubgraphData`
- **Statistics:** `GraphStats` (node/edge counts by type, largest files, most connected)
- **Search:** `SearchResult` (id, name, type, filePath, score)
- **Parse results:** `ParseResult`, `ParseStats`, `ParsedFileEntities`, `FileError`

### Plugin Types (`plugin.ts`)

Interfaces for language-specific parsing plugins:

- **`LanguagePlugin`** -- main plugin interface (id, extensions, grammar, extractors)
- **`EntityExtractors`** -- combines `CoreExtractors` and `OptionalExtractors`
- **`CoreExtractors`** -- required: `extractFunctions`, `extractClasses`, `extractVariables`, `extractImports`
- **`OptionalExtractors`** -- optional: `extractInterfaces`, `extractTypes`, `extractComponents`, `extractCalls`, `extractRenders`, `extractInheritance`
- **`SyntaxNode`** -- generic tree-sitter node interface
- **References:** `CallReference`, `RenderReference`, `InheritanceReference`
- **Registry:** `PluginRegistration`, `RegisteredPlugin`

### Document Types (`document.ts`)

Types for markdown/documentation indexing:

- **`MarkdownDocumentEntity`** -- document with frontmatter, title, hash
- **`SectionEntity`** -- heading with level and line range
- **`CodeBlockEntity`** -- fenced code block with language and content
- **`LinkEntity`** -- link with target, internal/external flag, anchor
- **`ExtractedDocumentEntities`** -- all entities from a single document

### NLP Types (`nlp.ts`)

Knowledge graph entity and relationship types with a guided open taxonomy:

- **Type system:** `EntityType`, `RelationshipType` (open strings, not closed unions)
- **Preferred types:** `CORE_ENTITY_TYPES`, `SE_ENTITY_TYPES`, `CORE_RELATIONSHIP_TYPES`, `SE_RELATIONSHIP_TYPES`
- **Normalization:** `normalizeEntityType()`, `normalizeRelationshipType()` with synonym maps
- **Domain presets:** `getPreferredEntityTypes(domain)`, `getPreferredRelationshipTypes(domain)`
- **Annotations:** `EntityAnnotation`, `RelationshipAnnotation`, `Sample`, `AnnotatedSample`
