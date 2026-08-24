# @codegraph/types

Private, runtime-free TypeScript contracts shared across the CodeGraph workspace.

## Contract modules

- `nodes.ts`: code, project, git, and graph node entities.
- `edges.ts`: persisted relationship types and pipeline transport descriptors.
- `graph.ts`: graph data, search, statistics, parsing, and visualization contracts.
- `plugin.ts`: language-plugin interfaces, extractors, and references.
- `document.ts`: Markdown document, section, code block, and link entities.
- `nlp.ts`: knowledge entity and relationship contracts plus normalization helpers.
- `labels.ts`: canonical node and symbol label constants.
- `history.ts`: `HistoryWindowOptions` and `HistoryCoverage`, including `historySince`, `historyMaxCommits`, completeness and truncation fields, and the deprecated `historyWindowSize` compatibility alias.
- `analysis.ts`: ownership input, contributor, file result, coverage, caveat, and truncation contracts.

## Persisted edge union

The `Edge` and `EdgeLabel` unions contain these relationships:

| Category | Edge labels |
| --- | --- |
| Structural | `CONTAINS` |
| Import and export | `IMPORTS`, `IMPORTS_SYMBOL`, `EXPORTS` |
| Calls | `CALLS` |
| Inheritance | `EXTENDS`, `IMPLEMENTS` |
| Type usage | `USES_TYPE`, `RETURNS`, `HAS_PARAM` |
| Class members | `HAS_METHOD`, `HAS_PROPERTY` |
| React | `RENDERS` |
| Git history | `INTRODUCED_IN`, `MODIFIED_IN`, `DELETED_IN` |
| Documents | `PARENT_SECTION` |
| Knowledge bridge | `ABOUT` |

Markdown documents attach sections, code blocks, and links through the generic `CONTAINS` edge. The edge union does not declare markdown-specific `HAS_SECTION`, `CONTAINS_CODE`, or `LINKS_TO` labels. It also does not declare instantiation or dataflow edges.

Transport-only descriptors such as export, imported-symbol, class-member, parameter, return, and type-use descriptors are separate from the persisted `Edge` union.
