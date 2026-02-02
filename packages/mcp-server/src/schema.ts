/**
 * MCP Server Schema Documentation
 * Static documentation of CodeGraph node and edge types for LLM context
 */

// ============================================================================
// Schema Documentation
// ============================================================================

/**
 * Generate schema documentation for LLM context
 * This is static content derived from @codegraph/types
 */
export function getSchemaDocumentation(): string {
  return `# CodeGraph Schema

## Node Types

| Type | Properties | Description |
|------|------------|-------------|
| **File** | path, extension, loc, hash | Source file in the codebase |
| **Function** | name, filePath, startLine, endLine, params, returnType, complexity | Function or method |
| **Class** | name, filePath, isExported, extends, implements | Class declaration |
| **Interface** | name, filePath, isExported, extends | Interface declaration |
| **Variable** | name, filePath, line, kind, isExported | Variable declaration |
| **Type** | name, filePath, kind (type/enum) | Type alias or enum |
| **Component** | name, filePath, props | React component |
| **Import** | source, filePath, specifiers | Import statement |

## Edge Types (Relationships)

| Edge | From → To | Description |
|------|-----------|-------------|
| **CONTAINS** | File → Function/Class/etc | File contains entity |
| **IMPORTS** | File → File | File imports from file |
| **IMPORTS_SYMBOL** | File → Function/Class/etc | File imports specific symbol |
| **CALLS** | Function → Function | Function calls function |
| **EXTENDS** | Class → Class | Class inheritance |
| **IMPLEMENTS** | Class → Interface | Interface implementation |
| **USES_TYPE** | Function/Variable → Type | Uses a type |
| **RENDERS** | Component → Component | React component renders another |
| **READS** | Function → Variable | Function reads variable |
| **WRITES** | Function → Variable | Function writes variable |
| **FLOWS_TO** | Node → Node | Data flow (taint tracking) |

## Query Patterns

Search by name:
\`\`\`
{ "query": "validateToken" }
{ "query": "auth" }
\`\`\`

Get file context:
\`\`\`
{ "file": "src/api/auth/login.ts" }
\`\`\`

Get symbol context:
\`\`\`
{ "symbol": "validateToken", "file": "src/api/auth/validate.ts" }
\`\`\`
`;
}

/**
 * Get a short schema summary for tool descriptions
 */
export function getShortSchema(): string {
  return `Nodes: File, Function, Class, Interface, Variable, Type, Component
Edges: CONTAINS, IMPORTS, CALLS, EXTENDS, IMPLEMENTS, USES_TYPE, RENDERS, READS, WRITES`;
}
