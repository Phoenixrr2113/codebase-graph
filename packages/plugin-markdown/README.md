# @codegraph/plugin-markdown

Markdown document plugin for CodeGraph. Parses `.md`, `.mdc`, and `.mdx` files into graph entities using a unified/remark pipeline.

## Philosophy

"Document AS the Graph" -- documents and sections become nodes, links become edges, code blocks are attached executable content, and frontmatter provides schema-agnostic metadata.

## Extracted Entities

| Entity | Description |
|--------|-------------|
| **MarkdownDocument** | Top-level document node with path, title, frontmatter, and content hash |
| **Section** | Heading-delimited section with level, heading text, and line range |
| **CodeBlock** | Fenced code block with language and content |
| **Link** | Internal or external link with target URL and line number |

## Graph Relationships

Document structure (a document attaching its sections, code blocks, and
links) is written with the generic `CONTAINS` edge, the same one File nodes
use for their functions and classes, not a set of markdown-specific edge
types. `PARENT_SECTION` is the one relationship this plugin's output is
actually used to build beyond `CONTAINS`: section-to-section heading nesting
within a single document, computed by `buildSectionHierarchy` (exported from
this package) and returned as `sectionHierarchy` alongside the entities
below.

| Relationship | From | To | Description |
|-------------|------|----|-------------|
| `CONTAINS` | MarkdownDocument | Section | Document contains a section |
| `CONTAINS` | MarkdownDocument | CodeBlock | Document contains a code block |
| `CONTAINS` | MarkdownDocument | Link | Document contains a link |
| `PARENT_SECTION` | Section | Section | Section nesting hierarchy (parent is the nearest preceding section with a smaller heading level) |

A `Link` entity's `target`/`isInternal`/`anchor` fields describe what it
points at, but no edge is currently drawn from the link to the document or
file it targets: only the `CONTAINS` edge from the containing document to
the `Link` node itself is written.

## Features

- **Frontmatter extraction**: Handles YAML, TOML, and JSON frontmatter via `gray-matter`. Title is resolved from frontmatter (`title` or `name` fields) or falls back to the first H1 heading.
- **Section hierarchy**: Headings are extracted with their nesting level, enabling parent-child section relationships.
- **GFM support**: Tables, strikethrough, task lists, and other GitHub Flavored Markdown extensions via `remark-gfm`.
- **Change detection**: Each document gets a SHA-256 content hash (truncated to 16 chars) for incremental reindexing.
- **Stable IDs**: Entities get deterministic IDs based on file path, content, and position, so re-parsing produces the same graph nodes.

## Parser Pipeline

1. `gray-matter` extracts frontmatter from raw content
2. `unified` + `remark-parse` parses markdown into an mdast AST
3. `remark-frontmatter` handles YAML/TOML frontmatter nodes in the AST
4. `remark-gfm` adds GFM syntax support
5. Extractors walk the AST to produce Section, CodeBlock, and Link entities

## API

```typescript
import { parseMarkdownFile, parseMarkdownContent, isSupported } from '@codegraph/plugin-markdown';

// Parse a file from disk
const entities = await parseMarkdownFile('/path/to/doc.md');
// => { document, sections, codeBlocks, links, sectionHierarchy }

// Parse content directly (no file I/O)
const entities = await parseMarkdownContent('# Hello\nWorld', 'virtual.md');

// Check extension support
isSupported('.mdx'); // true
```

## Dependencies

- `unified`, `remark-parse`, `remark-frontmatter`, `remark-gfm` -- parsing pipeline
- `gray-matter` -- frontmatter extraction
- `unist-util-visit` -- AST traversal
- `@codegraph/types` -- entity type definitions
