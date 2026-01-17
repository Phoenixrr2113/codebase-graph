# CodeGraph MVP Specification

**Project**: Visual Codebase Knowledge Graph
**Version**: 0.1.0 (MVP)
**Author**: Randy / RRW Technology & Services
**Date**: January 2026

---

## 1. Overview

### 1.1 Problem Statement
When onboarding to a new project or revisiting an existing codebase, developers waste significant time:
- Tracing function calls across files manually
- Understanding class hierarchies and inheritance chains
- Identifying which components depend on what
- Grasping the "shape" of the codebase architecture

### 1.2 Solution
A visual knowledge graph that automatically:
- Parses source code to extract entities (files, classes, functions, variables, imports)
- Maps relationships between entities (calls, imports, extends, implements, uses)
- Renders an interactive graph visualization
- Enables natural language and Cypher queries

### 1.3 MVP Scope
- **Languages**: TypeScript, JavaScript, React (TSX/JSX)
- **Graph DB**: FalkorDB (Redis-compatible, optimized for GraphRAG)
- **Visualization**: React + Cytoscape
- **Parser**: Tree-sitter (via tree-sitter-typescript)

### 1.4 Planned Language Support (Post-MVP)

| Phase | Languages | Timeline |
|-------|-----------|----------|
| MVP | TypeScript, JavaScript, React (TSX/JSX) | Week 1-2 |
| Phase 2 | C# / .NET | Week 3-4 |
| Phase 3 | Sitecore (Helix patterns, SXA, JSS) | Week 5-6 |
| Future | Python, Go, Rust | TBD |

The architecture is designed to be language-agnostic at the graph layer - only the parser package needs language-specific implementations.

---

## 2. Build Approach

### 2.1 Decision: Build From Scratch (Not Fork)

We are **building from scratch** rather than forking FalkorDB's code-graph repositories.

**FalkorDB Code Graph Current Stack:**
- Frontend: Next (TypeScript) - https://github.com/FalkorDB/code-graph
- Backend: Python Flask - https://github.com/FalkorDB/code-graph-backend
- Parser: Python-based (Python, Java, C only)
- SDK: graphrag-sdk (Python only)

**Why Not Fork:**

| Factor | Fork | Build From Scratch |
|--------|------|-------------------|
| Backend language | Python Flask (not our stack) | Node/TypeScript (our wheelhouse) |
| Parser | Python-only, limited languages | Tree-sitter, we control it |
| UI | Would need to gut 80% of it | Clean slate, designed for our needs |
| Technical debt | Inherit their decisions | None |
| .NET/Sitecore | Major surgery required | Architected for it from day 1 |
| Their roadmap | May diverge from our needs | We own the direction |
| Maintenance | Two codebases to track | Single codebase |

**Effort Analysis:**
- Forking saves ~1-2 days on FalkorDB connection boilerplate
- But costs weeks adapting Python backend to Node
- UI overhaul is same effort either way
- Net: Building fresh is faster for our requirements

### 2.2 Technology Stack

**All TypeScript** - single language across the entire stack:

```
┌─────────────────────────────────────────────────────────────────┐
│                      ALL TYPESCRIPT                              │
├─────────────────────────────────────────────────────────────────┤
│  packages/parser     → TypeScript + tree-sitter bindings        │
│  packages/graph      → TypeScript + falkordb client             │
│  packages/api        → TypeScript + Fastify                     │
│  packages/web        → TypeScript + React + Vite                │
└─────────────────────────────────────────────────────────────────┘
              │                            │
              ▼                            ▼
       ┌─────────────┐              ┌─────────────┐
       │ Tree-sitter │              │  FalkorDB   │
       │  (Rust/C)   │              │    (C)      │
       └─────────────┘              └─────────────┘
        Native speed                 Native speed
```

**Why Not Rust?**

Tree-sitter is already written in Rust/C. When using tree-sitter from Node, we're calling native code via bindings - the actual parsing is blazing fast.

Where time actually goes:
1. File I/O (reading source files) - native, fast
2. Tree-sitter parsing - native Rust/C, fast  
3. AST walking & extraction - JavaScript, but trivial work
4. Graph DB writes - FalkorDB (C), fast

Rust from scratch would only make sense if Tree-sitter didn't exist or we needed sub-millisecond parsing. Our bottleneck will be batch Cypher writes, not parsing.

**Expected Performance:**
- Parsing 1000 TypeScript files: ~2-5 seconds
- If that becomes a bottleneck later, we can:
  1. Parallelize with worker threads
  2. Rewrite just the parser in Rust with napi-rs bindings

### 2.3 What We Reference From FalkorDB Repos

Both repositories are MIT licensed. We will study, reference, and adapt specific patterns.

**Repository Links:**
- Frontend: https://github.com/FalkorDB/code-graph (Next, 641 commits, TypeScript)
- Backend: https://github.com/FalkorDB/code-graph-backend (Python Flask, 243 commits)

---

#### From `code-graph` (Frontend) - https://github.com/FalkorDB/code-graph

**Directory Structure to Study:**
```
code-graph/
├── app/                    # Next app directory
│   ├── api/               # API routes (reference for our API design)
│   └── page.tsx           # Main graph page layout
├── components/ui/         # shadcn/ui components (we use same library)
├── lib/                   # Utility functions
│   └── utils.ts           # Graph data transformations
└── e2e/                   # Playwright tests (reference for our tests)
```

**Specific Files to Reference:**

| File/Directory | What to Extract | How We Adapt |
|----------------|-----------------|--------------|
| `lib/utils.ts` | Graph data normalization, node/edge transformations | Port to TypeScript, add type safety |
| `app/api/` routes | API endpoint patterns for graph queries | Rewrite in Fastify with OpenAPI spec |
| `components/` graph components | Force-graph/Cytoscape initialization patterns | Enhance with multi-layout support |
| `tailwind.config.ts` | Color palette for node types | Use as starting point, extend for our types |
| `.env.template` | Required environment variables | Same pattern, different backend URL |

**UI Patterns to Copy:**
1. **Repository URL input** → Adapt to local folder picker + URL input
2. **Graph container layout** → Reference for panel sizing
3. **Natural language query box** → Keep similar UX, improve with streaming responses
4. **Node click interaction** → Reference click-to-expand pattern

**What NOT to Copy from Frontend:**
- Their Next structure (we use Vite + React)
- Their backend API calls to Flask (we call our own Node API)
- Server-side rendering patterns (we do client-side)

---

#### From `code-graph-backend` (Python) - https://github.com/FalkorDB/code-graph-backend

**Directory Structure to Study:**
```
code-graph-backend/
├── api/
│   └── index.py           # Flask routes, main entry point
├── static/                # Any static assets
└── tests/                 # Test patterns
```

**Critical: Graph Schema Design**

Their schema (from their blog and code) defines these entities. We adopt the same conceptual model:

```
THEIR NODE TYPES:              OUR EQUIVALENT:
─────────────────              ───────────────
Module                    →    File (we use File, more specific)
Class                     →    Class (same)
Function                  →    Function (same)
Argument                  →    (captured as Function property: params[])
Variable                  →    Variable (same)
File                      →    File (same)

THEIR EDGE TYPES:              OUR EQUIVALENT:
─────────────────              ───────────────
CONTAINS                  →    CONTAINS (same)
INHERITS                  →    EXTENDS (more TypeScript-native naming)
IMPLEMENTS                →    IMPLEMENTS (same)
CALLS                     →    CALLS (same)
HAS_ARGUMENT              →    (embedded in Function.params property)
DECLARES                  →    CONTAINS (consolidated)
USES                      →    USES_TYPE (more specific)
DEPENDS_ON                →    IMPORTS (more specific)
DEFINED_IN                →    (implicit via CONTAINS relationship)
```

**Cypher Query Patterns to Copy:**

Reference their query patterns and port to TypeScript:

```python
# THEIR PATTERN (Python):
g.query("""
    MERGE (f:File {path: $path})
    SET f.name = $name
    RETURN f
""", {'path': file_path, 'name': file_name})
```

```typescript
// OUR PATTERN (TypeScript):
await graph.query(`
  MERGE (f:File {path: $path})
  SET f.name = $name, f.hash = $hash, f.updatedAt = timestamp()
  RETURN f
`, { params: { path: filePath, name: fileName, hash: fileHash } });
```

**Key Cypher Patterns to Extract:**

| Pattern | Their Usage | Our Usage |
|---------|-------------|-----------|
| `MERGE` for upserts | Create/update nodes idempotently | Same - critical for incremental updates |
| `MATCH...DELETE` | Remove stale relationships | Same - cleanup on file re-parse |
| `MATCH (a)-[r]->(b)` | Traverse relationships | Same - for visualization queries |
| Graph creation per project | One graph per analyzed repo | Same - multi-project support |

**File Traversal Patterns:**

Their ignore patterns (from README):
```python
ignore = ["./.github", "./sbin", "./.git", "./deps", "./bin", "./build"]
```

Our equivalent:
```typescript
const DEFAULT_IGNORE = [
  '**/node_modules/**',
  '**/dist/**',
  '**/build/**',
  '**/.git/**',
  '**/coverage/**',
  '**/*.test.ts',
  '**/*.spec.ts',
  '**/.__snapshots__/**',
];
```

**What NOT to Copy from Backend:**
- Python AST parsing logic (we use Tree-sitter)
- Flask route handlers (we use Fastify)
- Their limited language detection (Python/Java/C only)
- graphrag-sdk dependency (Python-only library)

---

#### From FalkorDB Client Libraries

**Primary: `falkordb` npm package**

```bash
npm install falkordb
```

```typescript
import { FalkorDB } from 'falkordb';

const db = new FalkorDB({
  host: process.env.FALKORDB_HOST || 'localhost',
  port: parseInt(process.env.FALKORDB_PORT || '6379'),
});

const graph = db.selectGraph('my-project');

// Write query
await graph.query('CREATE (:File {path: $path})', { 
  params: { path: '/src/index.ts' } 
});

// Read-only query (uses replica if available)
const result = await graph.roQuery('MATCH (f:File) RETURN f.path');
```

**Natural Language Queries: Vercel AI SDK (NOT LangChain)**

We use Vercel AI SDK instead of `@falkordb/langchain-ts` for natural language → Cypher conversion.

**Why Vercel AI SDK over LangChain:**
| Feature | LangChain | Vercel AI SDK |
|---------|-----------|---------------|
| Bundle size | Heavy (~2MB) | Light (~50KB) |
| Provider switching | Verbose | One-line change |
| Streaming | Complex | Built-in |
| TypeScript | Decent | Excellent |
| Maintenance | Frequent breaking changes | Stable |

**Dependencies:**
```bash
npm install ai @ai-sdk/openai @ai-sdk/anthropic
```

**Implementation:**
```typescript
import { generateText } from 'ai';
import { openai } from '@ai-sdk/openai';

const CYPHER_SYSTEM_PROMPT = `You are a Cypher query generator for a code knowledge graph.

Schema:
- Nodes: File, Class, Function, Component, Variable, Type, Interface
- Edges: CALLS, IMPORTS, EXTENDS, IMPLEMENTS, RENDERS, CONTAINS, USES_TYPE

Properties:
- File: path, name, hash
- Function: name, filePath, startLine, endLine, isExported, isAsync, params, returnType
- Class: name, filePath, isExported, extends, implements

Given a natural language question, return ONLY valid Cypher query. No explanation.`;

export async function naturalLanguageToCypher(question: string): Promise<string> {
  const { text } = await generateText({
    model: openai('gpt-4o-mini'), // Fast & cheap for query generation
    system: CYPHER_SYSTEM_PROMPT,
    prompt: question,
  });
  return text.trim();
}

// Usage
const cypher = await naturalLanguageToCypher("What functions call processPayment?");
// → MATCH (f:Function)-[:CALLS]->(t:Function {name: 'processPayment'}) RETURN f.name, f.filePath

const result = await graph.roQuery(cypher);
```

**With Streaming Response:**
```typescript
import { streamText } from 'ai';
import { anthropic } from '@ai-sdk/anthropic';

export async function queryGraphWithExplanation(question: string, graph: Graph) {
  // Step 1: Generate Cypher
  const cypher = await naturalLanguageToCypher(question);
  
  // Step 2: Execute query
  const result = await graph.roQuery(cypher);
  
  // Step 3: Stream natural language explanation
  const { textStream } = await streamText({
    model: anthropic('claude-3-5-sonnet-20241022'),
    prompt: `Question: ${question}
Cypher: ${cypher}
Results: ${JSON.stringify(result.data, null, 2)}

Explain these code graph results concisely:`,
  });
  
  return { cypher, data: result.data, textStream };
}
```

**Advanced: Tool Calling for Autonomous Queries**
```typescript
import { generateText, tool } from 'ai';
import { z } from 'zod';

const result = await generateText({
  model: openai('gpt-4o'),
  tools: {
    queryCodeGraph: tool({
      description: 'Execute Cypher query against the code knowledge graph',
      parameters: z.object({
        cypher: z.string().describe('Valid Cypher query for code graph'),
      }),
      execute: async ({ cypher }) => {
        const result = await graph.roQuery(cypher);
        return result.data;
      },
    }),
  },
  maxSteps: 3, // Allow multiple queries if needed
  prompt: `Answer this question about the codebase: ${question}`,
});
```

**NOT using:**
- `@falkordb/langchain-ts` (unnecessary abstraction)
- `langchain` (heavy, complex)
- Any `@langchain/*` packages

---

#### From FalkorDB Documentation

**Key Docs to Reference:**
- Cypher query syntax: https://docs.falkordb.com/cypher/
- Client libraries: https://docs.falkordb.com/clients.html  
- Graph schema patterns: https://docs.falkordb.com/design-patterns.html

**Their Code Graph Blog Post Schema:**

From https://www.falkordb.com/blog/code-graph/:

```
Node Types (Python-focused, we adapt):
- Module: High-level grouping → We use File
- Class: Class definitions → Same
- Function: Functions/methods → Same  
- Argument: Function params → We embed as property
- Variable: Variables → Same

Edge Types:
- CONTAINS: Containment → Same
- INHERITS: Class inheritance → We call it EXTENDS
- IMPLEMENTS: Interface impl → Same
- CALLS: Function calls → Same
- HAS_ARGUMENT: Func → Arg → We embed in Function.params
- DECLARES: Variable decl → We use CONTAINS
- USES: Type usage → We call it USES_TYPE
- DEPENDS_ON: Imports → We call it IMPORTS
- DEFINED_IN: Location → Implicit via CONTAINS
```

---

#### Summary: Copy vs Build

| Component | Copy/Reference | Build Fresh |
|-----------|---------------|-------------|
| Graph schema concepts | ✅ Reference their node/edge types | Adapt naming for TypeScript |
| Cypher query patterns | ✅ Copy MERGE/MATCH patterns | Add TypeScript types |
| UI layout concepts | ✅ Reference panel structure | Rebuild in Vite/React |
| Color schemes | ✅ Use as starting point | Extend for more node types |
| Flask backend | ❌ | Build in Fastify |
| Python parsing | ❌ | Build with Tree-sitter |
| graphrag-sdk | ❌ | Use falkordb npm directly |
| LangChain | ❌ | Use Vercel AI SDK |
| File ignore patterns | ✅ Copy patterns | Extend for TS/Node projects |

### 2.4 FalkorDB Client Usage (TypeScript)

```typescript
import { FalkorDB } from 'falkordb';

// Connect to FalkorDB
const db = new FalkorDB({
  host: process.env.FALKORDB_HOST || 'localhost',
  port: parseInt(process.env.FALKORDB_PORT || '6379'),
});

// Select or create graph
const graph = db.selectGraph('codegraph');

// Execute Cypher queries
const result = await graph.query(`
  MERGE (f:File {path: $path})
  SET f.name = $name, f.hash = $hash
  RETURN f
`, {
  params: {
    path: '/src/index.ts',
    name: 'index.ts',
    hash: 'abc123'
  }
});

// Read-only queries
const functions = await graph.roQuery(`
  MATCH (f:Function)-[:CALLS]->(target:Function {name: $name})
  RETURN f.name, f.filePath
`, {
  params: { name: 'processPayment' }
});
```

### 2.5 What We DON'T Take

- Their Python Flask backend (we use Node)
- Their graphrag-sdk dependency (Python only)
- Their Python AST parsing (we use Tree-sitter)
- Their limited language support architecture
- Their single-layout visualization

---

## 3. Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                        FRONTEND (React)                          │
│  ┌─────────────────┐  ┌─────────────────┐  ┌─────────────────┐  │
│  │  Graph Canvas   │  │  Search/Query   │  │  Entity Detail  │  │
│  │  (Cytoscape) │  │  Panel          │  │  Panel          │  │
│  └────────┬────────┘  └────────┬────────┘  └────────┬────────┘  │
└───────────┼─────────────────────┼─────────────────────┼──────────┘
            │                     │                     │
            ▼                     ▼                     ▼
┌─────────────────────────────────────────────────────────────────┐
│                        API LAYER (Node)                       │
│  ┌─────────────────┐  ┌─────────────────┐  ┌─────────────────┐  │
│  │  Graph Routes   │  │  Query Routes   │  │  Parse Routes   │  │
│  │  /api/graph/*   │  │  /api/query/*   │  │  /api/parse/*   │  │
│  └────────┬────────┘  └────────┬────────┘  └────────┬────────┘  │
└───────────┼─────────────────────┼─────────────────────┼──────────┘
            │                     │                     │
            ▼                     ▼                     ▼
┌─────────────────────────────────────────────────────────────────┐
│                        CORE SERVICES                             │
│  ┌─────────────────┐  ┌─────────────────┐  ┌─────────────────┐  │
│  │  Graph Service  │  │  Query Engine   │  │  Parser Service │  │
│  │  (CRUD ops)     │  │  (Cypher + NL)  │  │  (Tree-sitter)  │  │
│  └────────┬────────┘  └────────┬────────┘  └────────┬────────┘  │
└───────────┼─────────────────────┼─────────────────────┼──────────┘
            │                     │                     │
            ▼                     ▼                     │
┌───────────────────────────────────────────┐          │
│           FalkorDB (Graph Database)        │◄─────────┘
│  ┌─────────────────────────────────────┐  │
│  │  Nodes: File, Class, Function, etc. │  │
│  │  Edges: CALLS, IMPORTS, EXTENDS...  │  │
│  └─────────────────────────────────────┘  │
└───────────────────────────────────────────┘
            ▲
            │
┌───────────┴───────────────────────────────┐
│         File Watcher (chokidar)            │
│  Monitors source files for changes         │
│  Triggers incremental re-parse             │
└───────────────────────────────────────────┘
```

---

## 3. Graph Schema

### 3.1 Node Types

| Node Label | Properties | Description |
|------------|------------|-------------|
| `File` | `path`, `name`, `extension`, `loc`, `lastModified`, `hash` | Source file |
| `Class` | `name`, `filePath`, `startLine`, `endLine`, `isExported`, `isAbstract`, `docstring` | Class declaration |
| `Interface` | `name`, `filePath`, `startLine`, `endLine`, `isExported`, `docstring` | Interface declaration |
| `Function` | `name`, `filePath`, `startLine`, `endLine`, `isExported`, `isAsync`, `isArrow`, `params`, `returnType`, `docstring` | Function/method |
| `Variable` | `name`, `filePath`, `line`, `kind` (const/let/var), `isExported`, `type` | Variable declaration |
| `Import` | `source`, `filePath`, `isDefault`, `isNamespace`, `specifiers` | Import statement |
| `Type` | `name`, `filePath`, `startLine`, `endLine`, `isExported`, `kind` (type/enum) | Type alias or enum |
| `Component` | `name`, `filePath`, `startLine`, `endLine`, `isExported`, `props` | React component (extends Function) |

### 3.2 Edge Types

| Edge Label | From → To | Properties | Description |
|------------|-----------|------------|-------------|
| `CONTAINS` | File → Class/Function/Variable/Type | | File contains entity |
| `IMPORTS` | File → File | `specifiers[]` | File imports from another |
| `IMPORTS_SYMBOL` | File → Class/Function/Variable/Type | `alias`, `isDefault` | Imports specific symbol |
| `CALLS` | Function → Function | `line`, `count` | Function calls another |
| `EXTENDS` | Class → Class | | Class inheritance |
| `IMPLEMENTS` | Class → Interface | | Interface implementation |
| `USES_TYPE` | Function/Variable → Type/Class/Interface | | References a type |
| `RETURNS` | Function → Type/Class/Interface | | Return type |
| `HAS_PARAM` | Function → Type/Class/Interface | `paramName`, `position` | Parameter type |
| `HAS_METHOD` | Class → Function | `visibility` | Class method |
| `HAS_PROPERTY` | Class → Variable | `visibility` | Class property |
| `RENDERS` | Component → Component | `line` | React component renders another |
| `USES_HOOK` | Component → Function | `hookName` | Component uses React hook |

### 3.3 Example Cypher Queries

```cypher
// Find all functions that call a specific function
MATCH (caller:Function)-[c:CALLS]->(target:Function {name: 'processPayment'})
RETURN caller.name, caller.filePath, c.line

// Find class hierarchy
MATCH path = (child:Class)-[:EXTENDS*]->(parent:Class)
WHERE child.name = 'PaymentProcessor'
RETURN path

// Find circular dependencies between files
MATCH (a:File)-[:IMPORTS]->(b:File)-[:IMPORTS]->(a)
RETURN a.path, b.path

// Find unused exports (no incoming IMPORTS_SYMBOL)
MATCH (f:Function {isExported: true})
WHERE NOT ()-[:IMPORTS_SYMBOL]->(f)
RETURN f.name, f.filePath

// Find most called functions
MATCH ()-[c:CALLS]->(f:Function)
RETURN f.name, f.filePath, count(c) as callCount
ORDER BY callCount DESC
LIMIT 10

// Find React components and what they render
MATCH (parent:Component)-[:RENDERS]->(child:Component)
RETURN parent.name, collect(child.name) as renders
```

---

## 4. Parser Service

### 4.1 Tree-sitter Configuration

```yaml
parser_config:
  languages:
    typescript:
      grammar: tree-sitter-typescript
      extensions: [.ts, .tsx]
      queries:
        - imports
        - exports
        - classes
        - functions
        - variables
        - types
        - jsx_elements
    javascript:
      grammar: tree-sitter-javascript
      extensions: [, x]
      queries:
        - imports
        - exports
        - classes
        - functions
        - variables
        - jsx_elements
    
    # Phase 2: C# / .NET
    csharp:
      grammar: tree-sitter-c-sharp
      extensions: [.cs]
      queries:
        - usings
        - namespaces
        - classes
        - interfaces
        - methods
        - properties
        - fields
        - attributes
        - dependency_injection
    
    # Phase 3: Sitecore-specific patterns
    sitecore:
      extends: csharp
      additional_queries:
        - helix_layers        # Foundation/Feature/Project
        - glass_mapper        # Glass.Mapper model mappings
        - sitecore_pipelines  # Pipeline processors
        - sxa_components      # SXA rendering variants
        - jss_components      # JSS component registrations
```

### 4.2 Extraction Pipeline

```yaml
extraction_pipeline:
  triggers:
    - initial_scan
    - file_change
    - file_create
    - file_delete
  
  steps:
    - name: read_file
      action: Read file contents and compute hash
      output: file_content, file_hash
    
    - name: check_cache
      action: Compare hash with stored hash
      decision_points:
        - condition: hash_unchanged
          action: skip_parsing
        - condition: hash_changed
          action: continue
    
    - name: parse_ast
      action: Parse file with Tree-sitter
      output: syntax_tree
    
    - name: extract_entities
      action: Walk AST and extract nodes
      extracts:
        - imports (source, specifiers, default/namespace)
        - exports (what's being exported)
        - classes (name, extends, implements, methods, properties)
        - functions (name, params, return type, async, arrow)
        - variables (name, kind, type annotation)
        - types (type aliases, enums, interfaces)
        - jsx_elements (component references in JSX)
      output: entity_list
    
    - name: resolve_references
      action: Link function calls to definitions
      strategy:
        - local_scope_first
        - file_scope_second  
        - imported_scope_third
      output: reference_edges
    
    - name: extract_docstrings
      action: Extract JSDoc comments for entities
      output: docstring_map
    
    - name: build_graph_operations
      action: Convert to Cypher MERGE statements
      output: cypher_batch
    
    - name: execute_transaction
      action: Run Cypher batch in FalkorDB
      cleanup: Remove stale nodes from previous parse of this file

  success_criteria:
    - all_entities_persisted
    - all_edges_created
    - stale_data_removed
```

### 4.3 Tree-sitter Queries (TypeScript)

```scheme
;; imports.scm - Extract import statements
(import_statement
  source: (string) @import.source
  (import_clause
    (identifier)? @import.default
    (namespace_import (identifier) @import.namespace)?
    (named_imports (import_specifier
      name: (identifier) @import.name
      alias: (identifier)? @import.alias)?)?))

;; functions.scm - Extract function declarations
(function_declaration
  name: (identifier) @function.name
  parameters: (formal_parameters) @function.params
  return_type: (type_annotation)? @function.return_type
  body: (statement_block) @function.body) @function.def

(arrow_function
  parameters: (formal_parameters) @arrow.params
  return_type: (type_annotation)? @arrow.return_type
  body: (_) @arrow.body) @arrow.def

;; classes.scm - Extract class declarations  
(class_declaration
  name: (type_identifier) @class.name
  (class_heritage
    (extends_clause (identifier) @class.extends)?
    (implements_clause (type_identifier) @class.implements)*)?
  body: (class_body) @class.body) @class.def

;; jsx.scm - Extract JSX component usage
(jsx_element
  open_tag: (jsx_opening_element
    name: (identifier) @jsx.component))

(jsx_self_closing_element
  name: (identifier) @jsx.component)
```

---

## 5. .NET and Sitecore Support (Phase 2-3)

### 5.1 C# / .NET Additional Node Types

| Node Label | Properties | Description |
|------------|------------|-------------|
| `Namespace` | `name`, `filePath` | Namespace declaration |
| `Method` | `name`, `filePath`, `startLine`, `endLine`, `visibility`, `isStatic`, `isAsync`, `isVirtual`, `isOverride`, `params`, `returnType`, `docstring` | Method (similar to Function but with .NET specifics) |
| `Property` | `name`, `filePath`, `line`, `type`, `hasGetter`, `hasSetter`, `visibility` | C# property |
| `Field` | `name`, `filePath`, `line`, `type`, `visibility`, `isReadonly`, `isStatic` | Class field |
| `Attribute` | `name`, `filePath`, `line`, `arguments` | C# attribute (decorator) |
| `DependencyRegistration` | `serviceType`, `implementationType`, `lifetime`, `filePath`, `line` | DI container registration |
| `Solution` | `path`, `name` | .sln file |
| `Project` | `path`, `name`, `targetFramework`, `projectType` | .csproj file |

### 5.2 C# / .NET Additional Edge Types

| Edge Label | From → To | Properties | Description |
|------------|-----------|------------|-------------|
| `IN_NAMESPACE` | Class/Interface → Namespace | | Entity belongs to namespace |
| `DECORATED_BY` | Class/Method/Property → Attribute | | Attribute decoration |
| `INJECTS` | Class → Class/Interface | `paramName`, `lifetime` | Constructor DI injection |
| `REGISTERS` | DependencyRegistration → Class/Interface | `as` | DI registration |
| `IN_PROJECT` | File → Project | | File belongs to project |
| `REFERENCES_PROJECT` | Project → Project | | Project reference |
| `REFERENCES_PACKAGE` | Project → Package | `version` | NuGet package reference |
| `OVERRIDES` | Method → Method | | Method override |
| `PARTIAL_OF` | Class → Class | | Partial class relationship |

### 5.3 Sitecore-Specific Node Types

| Node Label | Properties | Description |
|------------|------------|-------------|
| `HelixLayer` | `name` (Foundation/Feature/Project), `path` | Helix architecture layer |
| `HelixModule` | `name`, `layer`, `path` | Module within a Helix layer |
| `SitecoreTemplate` | `id`, `name`, `path`, `baseTemplates` | Sitecore template (from serialization) |
| `GlassModel` | `name`, `filePath`, `templateId`, `mappedFields` | Glass.Mapper model class |
| `Pipeline` | `name`, `patchFile` | Sitecore pipeline |
| `PipelineProcessor` | `name`, `filePath`, `pipeline`, `order` | Pipeline processor class |
| `Rendering` | `name`, `id`, `datasourceTemplate`, `controller` | Sitecore rendering |
| `SxaComponent` | `name`, `renderingVariants`, `filePath` | SXA component |
| `JssComponent` | `name`, `filePath`, `props`, `placeholders` | JSS React/Next component |

### 5.4 Sitecore-Specific Edge Types

| Edge Label | From → To | Properties | Description |
|------------|-----------|------------|-------------|
| `IN_LAYER` | HelixModule → HelixLayer | | Module belongs to Helix layer |
| `DEPENDS_ON_MODULE` | HelixModule → HelixModule | | Module dependency (must respect layer rules) |
| `MAPS_TO_TEMPLATE` | GlassModel → SitecoreTemplate | | Glass model maps to template |
| `PROCESSES` | PipelineProcessor → Pipeline | `order` | Processor handles pipeline |
| `USES_RENDERING` | View/Component → Rendering | | View uses rendering |
| `HAS_DATASOURCE` | Rendering → SitecoreTemplate | | Rendering datasource template |
| `CONTROLLER_FOR` | Class → Rendering | | Controller handles rendering |
| `VIOLATES_HELIX` | HelixModule → HelixModule | `rule` | Helix dependency violation (Feature→Foundation OK, Foundation→Feature BAD) |

### 5.5 .NET Project Structure Parsing

```yaml
dotnet_project_parsing:
  solution_file:
    parse: .sln
    extract:
      - project_references
      - solution_folders
      - configurations
  
  project_file:
    parse: .csproj
    extract:
      - target_framework
      - package_references
      - project_references
      - compile_items
      - embedded_resources
  
  dependency_injection:
    patterns:
      # Microsoft.Extensions.DependencyInjection
      - "services.AddScoped<$interface, $implementation>"
      - "services.AddTransient<$interface, $implementation>"
      - "services.AddSingleton<$interface, $implementation>"
      # Scrutor assembly scanning
      - "services.Scan(scan => scan.FromAssemblyOf<$marker>()...)"
    
    extract_from:
      - Startup.cs
      - Program.cs
      - "*ServiceCollectionExtensions.cs"
      - "*Installer.cs"
      - "*Registration.cs"
```

### 5.6 Sitecore-Specific Parsing

```yaml
sitecore_parsing:
  helix_detection:
    layer_folders:
      - src/Foundation
      - src/Feature  
      - src/Project
    module_marker_files:
      - "*.moduleon"      # Sitecore CLI
      - "moduleon"        # Legacy
    
    dependency_rules:
      allowed:
        - Project → Feature
        - Project → Foundation
        - Feature → Foundation
      violations:
        - Foundation → Feature
        - Foundation → Project
        - Feature → Project
  
  glass_mapper:
    detection:
      - "[SitecoreType(TemplateId = \"...\")]"
      - ": IGlassBase"
      - ": GlassBase"
    extract:
      - template_id
      - field_mappings
      - lazy_loading_config
  
  serialization:
    formats:
      - scs (Sitecore CLI)
      - yml (Unicorn)
      - json (TDS)
    extract:
      - template_definitions
      - field_definitions
      - base_template_inheritance
  
  pipeline_processors:
    config_files:
      - "App_Config/**/*.config"
      - "App_Config/Include/**/*.config"
    patterns:
      - "<processor type=\"$namespace.$class, $assembly\" />"
      - "<processor type=\"$class\" patch:after=\"...\""
  
  renderings:
    sources:
      - serialization files
      - .cshtml view files
      - Controller classes with [SitecoreController]
      - JSS component registrations
```

### 5.7 Helix Validation Queries

```cypher
// Find all Helix dependency violations
MATCH (source:HelixModule)-[v:DEPENDS_ON_MODULE]->(target:HelixModule)
WHERE (source.layer = 'Foundation' AND target.layer IN ['Feature', 'Project'])
   OR (source.layer = 'Feature' AND target.layer = 'Project')
RETURN source.name as violator, target.name as dependency, 
       source.layer as from_layer, target.layer as to_layer

// Find circular dependencies between modules
MATCH path = (m:HelixModule)-[:DEPENDS_ON_MODULE*2..10]->(m)
RETURN path

// Find Glass models without corresponding templates
MATCH (g:GlassModel)
WHERE NOT (g)-[:MAPS_TO_TEMPLATE]->(:SitecoreTemplate)
RETURN g.name, g.templateId, g.filePath

// Find unused pipeline processors
MATCH (p:PipelineProcessor)
WHERE NOT (p)-[:PROCESSES]->(:Pipeline)
RETURN p.name, p.filePath

// Analyze rendering usage across modules
MATCH (m:HelixModule)-[:CONTAINS]->(f:File)-[:CONTAINS]->(c)-[:USES_RENDERING]->(r:Rendering)
RETURN m.name, m.layer, collect(DISTINCT r.name) as renderings
```

### 5.8 Phase 2-3 Implementation Notes

```yaml
phase_2_dotnet:
  parser_approach: tree-sitter-c-sharp
  additional_parsing:
    - Roslyn for semantic analysis (type resolution, overloads)
    - MSBuild API for project/solution parsing
    - NuGet API for package metadata
  
  challenges:
    - Partial classes (need to merge across files)
    - Extension methods (static class → extended type)
    - Generics and type constraints
    - Expression-bodied members
    - Nullable reference types
  
  di_patterns:
    - Microsoft.Extensions.DependencyInjection
    - Autofac
    - SimpleInjector
    - Scrutor (assembly scanning)

phase_3_sitecore:
  prerequisites:
    - Phase 2 complete (C# parsing)
    - Access to Sitecore serialization files
  
  parsing_sources:
    - C# code (controllers, models, processors)
    - Serialization (templates, renderings)
    - Config files (pipelines, patches)
    - View files (.cshtml)
    - JSS manifests (if using JSS)
  
  challenges:
    - Config transforms and patches
    - Multiple serialization formats
    - Dynamic rendering parameters
    - Placeholder nesting
    - Multi-site configurations
  
  value_adds:
    - Helix violation detection
    - Unused template detection
    - Rendering coverage analysis
    - Pipeline processor ordering visualization
    - Glass model ↔ Template sync validation
```

---

## 6. Graph Database Layer

### 6.1 FalkorDB Setup

```yaml
database_config:
  provider: falkordb
  connection:
    host: localhost
    port: 6379
    graph_name: codegraph
  
  indexes:
    - label: File
      property: path
      type: exact
    - label: Function
      property: name
      type: fulltext
    - label: Class
      property: name
      type: fulltext
    - label: Component
      property: name
      type: fulltext
```

### 6.2 Graph Service Operations

```yaml
graph_service:
  operations:
    upsert_file:
      description: Create or update a File node
      cypher: |
        MERGE (f:File {path: $path})
        SET f.name = $name,
            f.extension = $extension,
            f.loc = $loc,
            f.lastModified = $lastModified,
            f.hash = $hash
        RETURN f
    
    upsert_function:
      description: Create or update a Function node
      cypher: |
        MERGE (fn:Function {name: $name, filePath: $filePath, startLine: $startLine})
        SET fn.endLine = $endLine,
            fn.isExported = $isExported,
            fn.isAsync = $isAsync,
            fn.isArrow = $isArrow,
            fn.params = $params,
            fn.returnType = $returnType,
            fn.docstring = $docstring
        WITH fn
        MATCH (f:File {path: $filePath})
        MERGE (f)-[:CONTAINS]->(fn)
        RETURN fn
    
    create_call_edge:
      description: Create CALLS relationship
      cypher: |
        MATCH (caller:Function {name: $callerName, filePath: $callerFile})
        MATCH (callee:Function {name: $calleeName, filePath: $calleeFile})
        MERGE (caller)-[c:CALLS]->(callee)
        ON CREATE SET c.line = $line, c.count = 1
        ON MATCH SET c.count = c.count + 1
        RETURN c
    
    delete_file_entities:
      description: Remove all entities from a deleted/changed file
      cypher: |
        MATCH (f:File {path: $path})-[:CONTAINS]->(e)
        DETACH DELETE e
        WITH f
        DETACH DELETE f
    
    get_file_graph:
      description: Get subgraph for a specific file
      cypher: |
        MATCH (f:File {path: $path})-[:CONTAINS]->(e)
        OPTIONAL MATCH (e)-[r]-(related)
        RETURN f, e, r, related
    
    get_function_callers:
      description: Find all functions that call a target
      cypher: |
        MATCH (caller:Function)-[c:CALLS]->(target:Function {name: $name})
        RETURN caller, c, target
    
    get_dependency_tree:
      description: Get import dependency tree from a file
      cypher: |
        MATCH path = (root:File {path: $path})-[:IMPORTS*1..5]->(dep:File)
        RETURN path
```

---

## 7. Visualization Layer

### 7.1 Frontend Stack

```yaml
frontend_stack:
  framework: React 18+ with TypeScript
  state_management: Zustand
  graph_library: Cytoscape
  ui_components: shadcn/ui
  styling: Tailwind CSS
  build: Vite
  ai_sdk: Vercel AI SDK (ai, @ai-sdk/openai, @ai-sdk/anthropic)
```

### 7.2 Component Structure

```
src/
├── components/
│   ├── graph/
│   │   ├── GraphCanvas.tsx       # Main Cytoscape container
│   │   ├── GraphControls.tsx     # Zoom, fit, layout buttons
│   │   ├── GraphLegend.tsx       # Node/edge type legend
│   │   └── NodeTooltip.tsx       # Hover tooltip for nodes
│   ├── panels/
│   │   ├── SearchPanel.tsx       # Search and filter
│   │   ├── QueryPanel.tsx        # Cypher query input
│   │   ├── EntityDetail.tsx      # Selected node details
│   │   └── FileTree.tsx          # Project file browser
│   └── layout/
│       ├── AppShell.tsx          # Main layout wrapper
│       └── ResizablePanels.tsx   # Draggable panel dividers
├── hooks/
│   ├── useGraph.ts               # Graph data fetching
│   ├── useCytoscape.ts           # Cytoscape instance management
│   └── useSearch.ts              # Search/filter logic
├── stores/
│   ├── graphStore.ts             # Graph state
│   └── uiStore.ts                # UI state (panels, selection)
├── services/
│   └── api.ts                    # API client
└── types/
    └── graph.ts                  # TypeScript types
```

### 7.3 Cytoscape Configuration

```yaml
cytoscape_config:
  layout:
    default: cose-bilkent  # Force-directed, good for code graphs
    alternatives:
      - dagre              # Hierarchical (good for inheritance)
      - concentric         # Circular by importance
      - breadthfirst       # Tree-like
  
  style:
    nodes:
      File:
        shape: round-rectangle
        background-color: "#6366f1"  # Indigo
        width: 40
        height: 40
      Class:
        shape: diamond
        background-color: "#f59e0b"  # Amber
        width: 35
        height: 35
      Interface:
        shape: diamond
        background-color: "#f59e0b"
        border-style: dashed
      Function:
        shape: ellipse
        background-color: "#10b981"  # Emerald
        width: 30
        height: 30
      Component:
        shape: round-rectangle
        background-color: "#06b6d4"  # Cyan
        width: 35
        height: 35
      Variable:
        shape: ellipse
        background-color: "#8b5cf6"  # Violet
        width: 20
        height: 20
      Type:
        shape: hexagon
        background-color: "#ec4899"  # Pink
        width: 25
        height: 25
    
    edges:
      CALLS:
        line-color: "#10b981"
        target-arrow-color: "#10b981"
        target-arrow-shape: triangle
        curve-style: bezier
      IMPORTS:
        line-color: "#6366f1"
        target-arrow-shape: triangle
        line-style: dashed
      EXTENDS:
        line-color: "#f59e0b"
        target-arrow-shape: triangle
        width: 3
      IMPLEMENTS:
        line-color: "#f59e0b"
        target-arrow-shape: triangle
        line-style: dashed
      RENDERS:
        line-color: "#06b6d4"
        target-arrow-shape: triangle
      CONTAINS:
        line-color: "#cbd5e1"
        opacity: 0.3
  
  interaction:
    node_click: show_detail_panel
    node_double_click: expand_connections
    node_hover: show_tooltip
    edge_hover: highlight_path
    background_click: deselect_all
    box_select: multi_select
    
  filters:
    by_type: [File, Class, Function, Component, Variable, Type, Interface]
    by_edge: [CALLS, IMPORTS, EXTENDS, IMPLEMENTS, RENDERS]
    by_file: file_path_filter
    by_search: name_search
    
  features:
    - zoom_to_fit
    - zoom_to_selection
    - expand_node (show connected nodes)
    - collapse_node (hide leaf nodes)
    - highlight_path (between two nodes)
    - export_png
    - export_json
```

### 7.4 Entity Detail Panel

```yaml
entity_detail_panel:
  sections:
    - header:
        - icon (based on node type)
        - name
        - type badge
        - exported badge (if applicable)
    
    - location:
        - file path (clickable, opens in VS Code)
        - line range
        - "Open in Editor" button
    
    - signature:
        - for functions: params and return type
        - for classes: extends/implements
        - for components: props interface
    
    - documentation:
        - docstring/JSDoc content
        - @param descriptions
        - @returns description
    
    - relationships:
        - incoming edges (grouped by type)
        - outgoing edges (grouped by type)
        - each item clickable to navigate
    
    - code_preview:
        - syntax highlighted source
        - collapsible
        - copy button
    
    - actions:
        - "Focus in Graph"
        - "Show All Connections"
        - "Find Usages"
        - "Copy Path"
```

---

## 8. API Layer

### 8.1 REST Endpoints

```yaml
api_endpoints:
  parse:
    POST /api/parse/project:
      description: Parse entire project directory
      body:
        path: string (absolute path to project root)
        ignore: string[] (glob patterns to ignore)
      response:
        status: "processing" | "complete" | "error"
        stats:
          files: number
          entities: number
          edges: number
          duration_ms: number
    
    POST /api/parse/file:
      description: Parse single file (incremental update)
      body:
        path: string
      response:
        entities: Entity[]
        edges: Edge[]
    
    DELETE /api/parse/file:
      description: Remove file from graph
      body:
        path: string
  
  graph:
    GET /api/graph/full:
      description: Get entire graph (for small projects)
      query:
        limit: number (default 1000)
      response:
        nodes: Node[]
        edges: Edge[]
    
    GET /api/graph/file/{path}:
      description: Get subgraph for a file
      response:
        nodes: Node[]
        edges: Edge[]
    
    GET /api/graph/entity/{id}:
      description: Get single entity with connections
      query:
        depth: number (default 1)
      response:
        entity: Node
        connections: { incoming: Edge[], outgoing: Edge[] }
    
    GET /api/graph/neighbors/{id}:
      description: Get neighboring nodes
      query:
        direction: "in" | "out" | "both"
        edgeTypes: string[] (filter by edge type)
        depth: number
      response:
        nodes: Node[]
        edges: Edge[]
  
  query:
    POST /api/query/cypher:
      description: Execute raw Cypher query
      body:
        query: string
        params: object
      response:
        results: any[]
    
    POST /api/query/natural:
      description: Natural language query (Vercel AI SDK)
      body:
        question: string
        stream: boolean (optional, default false)
      response:
        cypher: string (generated Cypher query)
        results: any[]
        explanation: string (if stream=false)
      streaming_response: # if stream=true
        text: ReadableStream<string>
  
  search:
    GET /api/search:
      description: Search entities by name
      query:
        q: string
        types: string[] (filter by node type)
        limit: number
      response:
        results: SearchResult[]
  
  stats:
    GET /api/stats:
      description: Get graph statistics
      response:
        totalNodes: number
        totalEdges: number
        nodesByType: { [type: string]: number }
        edgesByType: { [type: string]: number }
        largestFiles: { path: string, entityCount: number }[]
        mostConnected: { name: string, connectionCount: number }[]
```

---

## 9. File Watcher (Incremental Updates)

### 9.1 Watcher Configuration

```yaml
file_watcher:
  library: chokidar
  
  config:
    paths:
      - "**/*.ts"
      - "**/*.tsx"
      - "**/*"
      - "**/*x"
    ignored:
      - "**/node_modules/**"
      - "**/dist/**"
      - "**/build/**"
      - "**/.git/**"
      - "**/coverage/**"
      - "**/*.test.*"
      - "**/*.spec.*"
      - "**/__tests__/**"
    
    options:
      persistent: true
      ignoreInitial: true  # Don't fire for existing files on start
      awaitWriteFinish:
        stabilityThreshold: 300  # Wait for file to finish writing
        pollInterval: 100
  
  events:
    add:
      action: parse_and_add_file
    change:
      action: reparse_file
      steps:
        - delete_old_entities
        - parse_new_content
        - update_graph
    unlink:
      action: remove_file_from_graph
    
  debounce:
    enabled: true
    wait_ms: 500  # Batch rapid changes
```

---

## 10. Project Structure

```
codegraph/
├── packages/
│   ├── parser/                    # Tree-sitter parsing logic
│   │   ├── src/
│   │   │   ├── index.ts
│   │   │   ├── typescript.ts      # TS/TSX parser
│   │   │   ├── javascript.ts      # JS/JSX parser
│   │   │   ├── extractors/
│   │   │   │   ├── imports.ts
│   │   │   │   ├── functions.ts
│   │   │   │   ├── classes.ts
│   │   │   │   ├── variables.ts
│   │   │   │   ├── types.ts
│   │   │   │   └── jsx.ts
│   │   │   └── queries/           # Tree-sitter query files
│   │   │       ├── typescript.scm
│   │   │       └── javascript.scm
│   │   └── packageon
│   │
│   ├── graph/                     # Graph database operations
│   │   ├── src/
│   │   │   ├── index.ts
│   │   │   ├── client.ts          # FalkorDB connection
│   │   │   ├── schema.ts          # Node/Edge type definitions
│   │   │   ├── operations.ts      # CRUD operations
│   │   │   └── queries.ts         # Predefined Cypher queries
│   │   └── packageon
│   │
│   ├── api/                       # Express API server
│   │   ├── src/
│   │   │   ├── index.ts
│   │   │   ├── routes/
│   │   │   │   ├── parse.ts
│   │   │   │   ├── graph.ts
│   │   │   │   ├── query.ts
│   │   │   │   └── search.ts
│   │   │   ├── services/
│   │   │   │   ├── parseService.ts
│   │   │   │   └── watchService.ts
│   │   │   └── middleware/
│   │   │       └── errorHandler.ts
│   │   └── packageon
│   │
│   └── web/                       # React frontend
│       ├── src/
│       │   ├── components/
│       │   ├── hooks/
│       │   ├── stores/
│       │   ├── services/
│       │   ├── types/
│       │   ├── App.tsx
│       │   └── main.tsx
│       ├── packageon
│       └── vite.config.ts
│
├── docker-compose.yml             # FalkorDB + API + Frontend
├── packageon                   # Workspace root
├── turboon                     # Turborepo config
└── README.md
```

---

## 11. Docker Compose Setup

```yaml
# docker-compose.yml
version: "3.9"

services:
  falkordb:
    image: falkordb/falkordb:latest
    ports:
      - "6379:6379"
    volumes:
      - falkordb_data:/data
    command: ["--loadmodule", "/usr/lib/redis/modules/falkordb.so"]

  api:
    build:
      context: .
      dockerfile: packages/api/Dockerfile
    ports:
      - "3001:3001"
    environment:
      - FALKORDB_HOST=falkordb
      - FALKORDB_PORT=6379
      - PROJECT_ROOT=/workspace
    volumes:
      - ${PROJECT_PATH:-./sample}:/workspace:ro
    depends_on:
      - falkordb

  web:
    build:
      context: .
      dockerfile: packages/web/Dockerfile
    ports:
      - "3000:3000"
    environment:
      - VITE_API_URL=http://localhost:3001
    depends_on:
      - api

volumes:
  falkordb_data:
```

---

## 12. MVP Implementation Tasks

```yaml
implementation_tasks:
  phase_1_core_parsing:
    duration: 3-4 days
    tasks:
      - setup_monorepo:
          description: Initialize turborepo with packages structure
          priority: 1
      
      - implement_ts_parser:
          description: Tree-sitter TypeScript parsing
          subtasks:
            - Setup tree-sitter-typescript
            - Write extraction queries for imports
            - Write extraction queries for functions/classes
            - Write extraction queries for JSX components
            - Handle arrow functions and async
          priority: 1
      
      - implement_reference_resolution:
          description: Link function calls to definitions
          subtasks:
            - Build symbol table per file
            - Resolve local references
            - Resolve imported references
          priority: 2
    
    success_criteria:
      - Can parse a TypeScript file and extract all entities
      - Can identify function calls and link to definitions
      - Can extract React component render relationships

  phase_2_graph_layer:
    duration: 2-3 days
    tasks:
      - setup_falkordb:
          description: Docker setup and connection
          priority: 1
      
      - implement_graph_operations:
          description: CRUD operations for nodes/edges
          subtasks:
            - Upsert operations for all node types
            - Edge creation with deduplication
            - File deletion cascade
          priority: 1
      
      - implement_project_scan:
          description: Full project parsing pipeline
          subtasks:
            - File discovery with glob patterns
            - Parallel file parsing
            - Batch graph insertion
          priority: 2
    
    success_criteria:
      - Can persist parsed entities to FalkorDB
      - Can query graph with Cypher
      - Can parse entire project in reasonable time

  phase_3_api:
    duration: 2 days
    tasks:
      - setup_express:
          description: Basic Express server with routes
          priority: 1
      
      - implement_parse_endpoints:
          description: /api/parse/* routes
          priority: 1
      
      - implement_graph_endpoints:
          description: /api/graph/* routes
          priority: 1
      
      - implement_search:
          description: /api/search endpoint
          priority: 2
    
    success_criteria:
      - Can trigger parse via API
      - Can query graph via API
      - Can search entities by name

  phase_4_visualization:
    duration: 3-4 days
    tasks:
      - setup_react_app:
          description: Vite + React + TypeScript setup
          priority: 1
      
      - implement_graph_canvas:
          description: Cytoscape integration
          subtasks:
            - Basic rendering with node/edge styles
            - Layout switching
            - Zoom and pan controls
          priority: 1
      
      - implement_entity_panel:
          description: Selected node detail view
          priority: 2
      
      - implement_search_panel:
          description: Search and filter UI
          priority: 2
      
      - implement_file_tree:
          description: Project file browser
          priority: 3
    
    success_criteria:
      - Can visualize graph in browser
      - Can click nodes to see details
      - Can search and filter nodes
      - Can switch layouts

  phase_5_watcher:
    duration: 1-2 days
    tasks:
      - implement_file_watcher:
          description: Chokidar integration for live updates
          subtasks:
            - Watch for file changes
            - Incremental re-parse
            - WebSocket updates to frontend
          priority: 1
    
    success_criteria:
      - Graph updates when files change
      - Frontend receives live updates

total_estimated_duration: 11-15 days
```

---

## 13. Future Enhancements (Post-MVP)

```yaml
future_enhancements:
  natural_language_queries:
    description: Use LLM to convert questions to Cypher
    examples:
      - "What functions call processPayment?"
      - "Show me the class hierarchy for PaymentProcessor"
      - "Find circular dependencies"
  
  git_integration:
    description: Overlay git history on graph
    features:
      - Last modified date per entity
      - Author information
      - Commit history for nodes
      - "Hot spots" visualization (frequently changed)
  
  documentation_layer:
    description: Extract and display documentation
    features:
      - JSDoc parsing
      - README linking
      - Inline comments extraction
  
  test_coverage_overlay:
    description: Show test coverage on graph
    features:
      - Which functions have tests
      - Coverage percentage per file
      - Link to test files
  
  multi_repo_support:
    description: Unified graph across repos
    features:
      - Cross-repo imports
      - Shared package tracking
      - Monorepo support
  
  additional_languages:
    description: Support more languages via Tree-sitter (beyond planned Phase 2-3)
    languages:
      - Python
      - Go
      - Rust
      - Java
    note: C#/.NET and Sitecore are covered in Phase 2-3 (see Section 5)
  
  vs_code_extension:
    description: Integrate with VS Code
    features:
      - Graph view in sidebar
      - "Show in Graph" command
      - Navigate from graph to code
  
  ai_insights:
    description: LLM-powered code analysis
    features:
      - Code smell detection
      - Refactoring suggestions
      - Documentation generation
      - "Explain this module"
```

---

## 14. Sample Usage

### Starting the Stack

```bash
# Clone and setup
git clone https://github.com/rrw/codegraph.git
cd codegraph
pnpm install

# Start FalkorDB
docker-compose up -d falkordb

# Start API (dev mode)
pnpm --filter api dev

# Start Frontend (dev mode)  
pnpm --filter web dev

# Parse a project
curl -X POST http://localhost:3001/api/parse/project \
  -H "Content-Type: application/json" \
  -d '{"path": "/path/to/your/project", "ignore": ["node_modules", "dist"]}'

# Open browser
open http://localhost:3000
```

### Example Workflow

1. Open CodeGraph in browser
2. Enter project path and click "Parse"
3. Wait for parsing to complete (progress shown)
4. Graph renders with files as nodes
5. Click a file to expand and see contained entities
6. Click a function to see its connections
7. Use search to find specific entities
8. Switch layouts to see different perspectives
9. Export graph as PNG for documentation

---

## Appendix A: Technology Decisions

| Component | Choice | Rationale |
|-----------|--------|-----------|
| Parser | Tree-sitter | Fast, incremental, multi-language support, battle-tested |
| Graph DB | FalkorDB | Redis-compatible, GraphRAG optimized, Cypher support, low latency |
| Frontend | React + Cytoscape | Mature ecosystem, Cytoscape is the gold standard for graph viz |
| API | Fastify/Node | Same language as frontend, excellent TypeScript support, fast |
| Monorepo | Turborepo | Fast builds, good DX, TypeScript-first |
| Styling | Tailwind + shadcn | Rapid UI development, consistent design |
| AI/LLM | Vercel AI SDK | Lightweight (~50KB), streaming built-in, multi-provider, great TypeScript |
| NOT using | LangChain | Heavy (~2MB), unnecessary abstraction, complex, frequent breaking changes |

---

## Appendix B: References

- Tree-sitter: https://tree-sitter.github.io/tree-sitter/
- FalkorDB: https://www.falkordb.com/
- Cytoscape: https://js.cytoscape.org/
- Vercel AI SDK: https://sdk.vercel.ai/
- FalkorDB Code Graph: https://github.com/FalkorDB/code-graph
- code-graph-rag: https://github.com/vitali87/code-graph-rag