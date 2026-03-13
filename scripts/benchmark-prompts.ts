#!/usr/bin/env npx tsx
/**
 * Prompt Engineering A/B Benchmark
 *
 * Tests 8 prompt engineering techniques across 3 Cerebras models and 4 task types.
 * Produces a comparison matrix of latency vs quality for each combination.
 *
 * Requires FalkorDB running locally (for NL_TO_CYPHER Cypher execution).
 *
 * Usage: pnpm build && npx tsx scripts/benchmark-prompts.ts
 */

import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { existsSync, readFileSync } from 'node:fs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');

// Load .env
const envPath = resolve(ROOT, '.env');
if (existsSync(envPath)) {
  for (const line of readFileSync(envPath, 'utf-8').split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq > 0) {
      const key = trimmed.slice(0, eq).trim();
      const val = trimmed.slice(eq + 1).trim().replace(/^["']|["']$/g, '');
      if (!process.env[key]) process.env[key] = val;
    }
  }
}

if (!process.env['CEREBRAS_API_KEY']) {
  console.error('ERROR: CEREBRAS_API_KEY not set in .env');
  process.exit(1);
}

// Dynamic imports (pnpm workspace resolution)
const ai = await import('../packages/plugin-nlp/node_modules/ai/dist/index.js');
const { generateText, Output } = ai;
const { createOpenAICompatible } = await import(
  '../packages/plugin-nlp/node_modules/@ai-sdk/openai-compatible/dist/index.js'
);
const { NLToCypherSchema, GraphAnswerSchema, ContextWalkStepSchema, SearchRouteSchema } =
  await import('../packages/plugin-nlp/dist/index.js');
const { getGraphClient, closeGraphClient } = await import('../packages/core/dist/index.js');

// =============================================================================
// Setup
// =============================================================================

const cerebras = createOpenAICompatible({
  name: 'cerebras',
  baseURL: 'https://api.cerebras.ai/v1',
  headers: { Authorization: `Bearer ${process.env['CEREBRAS_API_KEY']}` },
  supportsStructuredOutputs: true,
});

const MODELS = ['llama3.1-8b', 'gpt-oss-120b', 'qwen-3-235b-a22b-instruct-2507'];
const MODEL_LABELS: Record<string, string> = {
  'llama3.1-8b': 'llama-8b',
  'gpt-oss-120b': 'gpt-120b',
  'qwen-3-235b-a22b-instruct-2507': 'qwen-235b',
};
const ROUNDS = 2;

type TaskType = 'NL_TO_CYPHER' | 'GRAPH_ANSWER' | 'CONTEXT_WALK' | 'ROUTING';
type Technique =
  | 'baseline'
  | 'few-shot'
  | 'chain-of-thought'
  | 'schema-aware'
  | 'negative-examples'
  | 'compressed'
  | 'system-user-split'
  | 'combined-best';

const TECHNIQUES: Technique[] = [
  'baseline', 'few-shot', 'chain-of-thought', 'schema-aware',
  'negative-examples', 'compressed', 'system-user-split', 'combined-best',
];

interface PromptVariant {
  system?: string;
  prompt: string;
}

interface TestCase {
  id: string;
  task: TaskType;
  query: string;
  description: string;
  expectedRoute?: string;
  expectedNames?: string[];
  expectedMentions?: string[];
  expectedActions?: string[];
  mockContext?: string;
  mockWalkHistory?: string[];
}

interface BenchmarkResult {
  task: TaskType;
  technique: Technique;
  model: string;
  testId: string;
  round: number;
  latencyMs: number;
  qualityScore: number;
  error?: string;
}

// =============================================================================
// Graph Schema (shared across NL_TO_CYPHER prompt variants)
// =============================================================================

const SCHEMA_DESCRIPTION = `
## FalkorDB Graph Schema

### Code Nodes (labels):
- File: { name, filePath, language, linesOfCode, embedding }
  - "name" is the filename only (e.g. "auth.ts"), "filePath" is the full path
- Function: { name, filePath, startLine, endLine, signature, docstring, complexity, linesOfCode, isExported, isAsync, embedding }
- Class: { name, filePath, startLine, endLine, docstring, linesOfCode, isExported, isAbstract, embedding }
- Interface: { name, filePath, startLine, endLine, docstring, isExported, embedding }
- Type: { name, filePath, startLine, endLine, kind, isExported, embedding }
- Variable: { name, filePath, startLine, endLine, kind, isExported, embedding }
- Component: { name, filePath, startLine, endLine, docstring, props, isExported, embedding }

### Knowledge Nodes:
- Entity: { text, type, confidence, sampleId, createdAt, lastAccessedAt, accessCount, embedding }

### Code Edges:
- CONTAINS: File → Function/Class/Interface/Type/Variable/Component
- CALLS: Function → Function { line, count }
- IMPORTS: File → File { specifiers }
- IMPORTS_SYMBOL: File → Function/Class/etc { alias, isDefault }
- EXTENDS: Class → Class, Interface → Interface
- IMPLEMENTS: Class → Interface
- USES_TYPE: Function/Variable → Type/Class/Interface
- HAS_METHOD: Class → Function { visibility }
- HAS_PROPERTY: Class → Variable { visibility }
- RENDERS: Component → Component { line }
- USES_HOOK: Component → Function { hookName }
- READS: Function → Variable
- WRITES: Function → Variable

### Knowledge Edges:
- RELATES_TO: Entity → Entity { type, confidence, fact, valid_at, invalid_at, created_at, fact_embedding }

### Bridge Edges:
- ABOUT: Entity → Function/Class/Interface/File (links knowledge to code)

### Example Queries:

Find functions by name (fuzzy):
  MATCH (f:Function) WHERE toLower(f.name) CONTAINS toLower('payment') RETURN f.name, f.filePath, f.startLine LIMIT 20

Find what a file contains:
  MATCH (f:File)-[:CONTAINS]->(c) WHERE toLower(f.filePath) CONTAINS toLower('command-center') RETURN c.name, labels(c) AS type, c.startLine

Functions that call a specific function:
  MATCH (caller:Function)-[:CALLS]->(callee:Function) WHERE toLower(callee.name) CONTAINS toLower('validate') RETURN caller.name, caller.filePath, callee.name LIMIT 20

Find most complex functions:
  MATCH (f:Function) WHERE f.complexity IS NOT NULL RETURN f.name, f.filePath, f.complexity ORDER BY f.complexity DESC LIMIT 20

Find classes implementing an interface:
  MATCH (c:Class)-[:IMPLEMENTS]->(i:Interface) WHERE toLower(i.name) CONTAINS toLower('search') RETURN c.name, c.filePath, i.name

What does a component render:
  MATCH (c:Component)-[:RENDERS]->(child:Component) WHERE toLower(c.name) CONTAINS toLower('app') RETURN c.name, child.name, child.filePath
`.trim();

// =============================================================================
// Test Cases
// =============================================================================

const TEST_CASES: TestCase[] = [
  // --- NL_TO_CYPHER ---
  {
    id: 'cypher-1',
    task: 'NL_TO_CYPHER',
    query: 'Find all functions that call hybridSearch',
    description: 'Graph traversal — callers of hybridSearch',
    expectedNames: ['search'],
  },
  {
    id: 'cypher-2',
    task: 'NL_TO_CYPHER',
    query: 'Show me all classes in the search directory',
    description: 'Class listing with path filter',
    expectedNames: ['SearchRegistry', 'Strategy'],
  },
  {
    id: 'cypher-3',
    task: 'NL_TO_CYPHER',
    query: 'What functions does the file graphAnswer.ts contain?',
    description: 'File → CONTAINS → Function traversal',
    expectedNames: ['search', 'buildContextFromHits', 'buildAnswerPrompt'],
  },

  // --- GRAPH_ANSWER ---
  {
    id: 'answer-1',
    task: 'GRAPH_ANSWER',
    query: 'What does the hybridSearch function do?',
    description: 'Question about a specific function',
    expectedMentions: ['vector', 'text', 'graph', 'result'],
    mockContext: `[Function] hybridSearch (packages/core/src/hybridSearch.ts:45)
  Doc: Combines vector similarity search, text matching, and graph traversal to produce ranked results
  Sig: function hybridSearch(query: string, client: GraphClient, options: HybridSearchOptions): Promise<HybridSearchResult>
[Related: CALLS] generateEmbedding (Function) (packages/plugin-nlp/src/embeddings.ts)
[Related: CALLS] roQuery (Function) (packages/graph/src/client.ts)
[Related: CONTAINS] hybridSearch.ts (File) (packages/core/src/hybridSearch.ts)`,
  },
  {
    id: 'answer-2',
    task: 'GRAPH_ANSWER',
    query: 'How is the SearchRegistry used?',
    description: 'Question about class usage pattern',
    expectedMentions: ['register', 'strategy', 'search'],
    mockContext: `[Class] SearchRegistry (packages/core/src/search/registry.ts:19)
  Doc: Manages registered search strategies and dispatches queries to the appropriate strategy
[Function] register (packages/core/src/search/registry.ts:26)
  Sig: register(strategy: SearchStrategy): void
[Function] search (packages/core/src/search/registry.ts:75)
  Sig: search(request: SearchRequest, context: SearchContext): Promise<SearchResponse>
[Related: CALLS] register → HybridSearchStrategy (Class)
[Related: CALLS] register → NLToCypherStrategy (Class)
[Related: CALLS] register → GraphAnswerStrategy (Class)
[Related: CALLS] register → ContextWalkStrategy (Class)`,
  },

  // --- CONTEXT_WALK ---
  {
    id: 'walk-1',
    task: 'CONTEXT_WALK',
    query: 'How does data flow from the API handler to the graph database?',
    description: 'Early walk — should expand or refine',
    expectedActions: ['expand', 'refine'],
    mockContext: `## Discovered Nodes (3)
- [Function] search (packages/core/src/search/registry.ts:75) (score: 0.85)
- [Class] SearchRegistry (packages/core/src/search/registry.ts:19) (score: 0.80)
- [Function] roQuery (packages/graph/src/client.ts:42) (score: 0.72)

## Discovered Relationships (2)
- SearchRegistry --[HAS_METHOD]--> search (Function)
- search --[CALLS]--> roQuery (Function)`,
    mockWalkHistory: [
      'Round 0 (seed): Found 3 nodes and 2 relationships for "How does data flow from the API handler to the graph database?"',
    ],
  },
  {
    id: 'walk-2',
    task: 'CONTEXT_WALK',
    query: 'What components render the search results page?',
    description: 'Sufficient context — should answer',
    expectedActions: ['answer'],
    mockContext: `## Discovered Nodes (8)
- [Component] SearchResults (packages/web/src/components/SearchResults.tsx:12) (score: 0.95)
- [Component] ResultCard (packages/web/src/components/ResultCard.tsx:8) (score: 0.88)
- [Component] SearchBar (packages/web/src/components/SearchBar.tsx:5) (score: 0.85)
- [Component] CodePreview (packages/web/src/components/CodePreview.tsx:10) (score: 0.80)
- [Function] useSearch (packages/web/src/hooks/useSearch.ts:3) (score: 0.75)
- [Component] GraphVisualization (packages/web/src/components/GraphVisualization.tsx:7) (score: 0.70)
- [Component] NodeDetails (packages/web/src/components/NodeDetails.tsx:15) (score: 0.65)
- [Component] App (packages/web/src/App.tsx:1) (score: 0.60)

## Discovered Relationships (6)
- SearchResults --[RENDERS]--> ResultCard (Component)
- SearchResults --[RENDERS]--> CodePreview (Component)
- SearchResults --[USES_HOOK]--> useSearch (Function)
- App --[RENDERS]--> SearchResults (Component)
- App --[RENDERS]--> SearchBar (Component)
- App --[RENDERS]--> GraphVisualization (Component)`,
    mockWalkHistory: [
      'Round 0 (seed): Found 4 nodes for "What components render the search results page?"',
      'Round 1: Action=expand, Reasoning="Expand SearchResults to find child components"',
      '  Expanded from "SearchResults": 4 new nodes',
    ],
  },

  // --- ROUTING ---
  {
    id: 'route-1',
    task: 'ROUTING',
    query: 'sendEmail',
    description: 'Simple symbol lookup → HYBRID',
    expectedRoute: 'HYBRID',
  },
  {
    id: 'route-2',
    task: 'ROUTING',
    query: 'What does the authentication module do?',
    description: 'Explanation question → GRAPH_ANSWER',
    expectedRoute: 'GRAPH_ANSWER',
  },
  {
    id: 'route-3',
    task: 'ROUTING',
    query: 'Find all functions that call validateInput',
    description: 'Structural graph query → NL_TO_CYPHER',
    expectedRoute: 'NL_TO_CYPHER',
  },
  {
    id: 'route-4',
    task: 'ROUTING',
    query: 'How does data flow from the API handler through middleware to the database?',
    description: 'Multi-hop exploration → CONTEXT_WALK',
    expectedRoute: 'CONTEXT_WALK',
  },
  {
    id: 'route-5',
    task: 'ROUTING',
    query: 'Explain how the indexer resolves cross-file dependencies',
    description: 'Complex explanation → GRAPH_ANSWER',
    expectedRoute: 'GRAPH_ANSWER',
  },
];

// =============================================================================
// Prompt Variant Builders
// =============================================================================

// ---- NL_TO_CYPHER variants ----

const CYPHER_RULES = `## Important Rules:
1. Only generate READ queries (MATCH, CALL, RETURN). Never use CREATE, SET, DELETE, MERGE.
2. ALWAYS use toLower() + CONTAINS for name/path matching — NEVER exact equality on names.
   GOOD: WHERE toLower(n.name) CONTAINS toLower('auth')
   BAD:  WHERE n.name = 'auth.ts'
3. When the user mentions a file, search filePath with CONTAINS, not the name field.
4. Always include a RETURN clause with useful fields (name, filePath, startLine, etc).
5. Limit results to 50 unless the user asks for more.
6. For "how does X work" questions, find the entity and its relationships.
7. Use labels(n) to return node types when useful.`;

const CYPHER_FEW_SHOT = `## Input/Output Examples:

Input: "Find all functions that call sendEmail"
Output Cypher: MATCH (caller:Function)-[:CALLS]->(callee:Function) WHERE toLower(callee.name) CONTAINS toLower('sendemail') RETURN caller.name, caller.filePath, callee.name LIMIT 50

Input: "What files import the config module?"
Output Cypher: MATCH (f1:File)-[:IMPORTS]->(f2:File) WHERE toLower(f2.filePath) CONTAINS toLower('config') RETURN f1.name, f1.filePath, f2.name LIMIT 50

Input: "Show me the most complex functions"
Output Cypher: MATCH (f:Function) WHERE f.complexity IS NOT NULL RETURN f.name, f.filePath, f.complexity ORDER BY f.complexity DESC LIMIT 20`;

const CYPHER_COT = `## Think step by step before writing the query:
1. Identify which node types (File, Function, Class, etc.) are relevant to the question
2. Identify which edge types (CALLS, CONTAINS, IMPORTS, etc.) connect them
3. Determine the MATCH pattern with correct labels and edge directions
4. Add WHERE filters using toLower() + CONTAINS for any name/path matching
5. Write the RETURN clause with useful fields (name, filePath, startLine)
6. Add LIMIT 50`;

const CYPHER_SCHEMA_AWARE = `## Expected Output Format:
Your response must contain exactly these fields:
- "cypher": A valid read-only Cypher query for FalkorDB. Must start with MATCH.
- "explanation": One sentence describing what the query does in plain English.
- "parametersJson": (optional) Omit unless the query uses $param syntax.`;

const CYPHER_NEGATIVE = `## Common Mistakes to AVOID:
- DO NOT use exact equality: WHERE n.name = 'auth.ts' (WRONG) → Use toLower()+CONTAINS
- DO NOT generate queries without a RETURN clause
- DO NOT use CREATE, SET, DELETE, or MERGE
- DO NOT match on 'name' when user mentions a file — use 'filePath' instead
- DO NOT return * — always specify which properties to return
- DO NOT reverse edge directions: CONTAINS goes File→Function, CALLS goes Function→Function`;

function buildNLToCypherVariant(technique: Technique, query: string): PromptVariant {
  switch (technique) {
    case 'baseline':
      return {
        prompt: `You are a Cypher query expert for FalkorDB (a Redis-based graph database).
Translate the user's natural language question into a valid Cypher query.

${SCHEMA_DESCRIPTION}

${CYPHER_RULES}

## User Question:
"${query}"

Generate a Cypher query that answers this question.`,
      };

    case 'few-shot':
      return {
        prompt: `You are a Cypher query expert for FalkorDB (a Redis-based graph database).
Translate the user's natural language question into a valid Cypher query.

${SCHEMA_DESCRIPTION}

${CYPHER_RULES}

${CYPHER_FEW_SHOT}

## User Question:
"${query}"

Generate a Cypher query that answers this question.`,
      };

    case 'chain-of-thought':
      return {
        prompt: `You are a Cypher query expert for FalkorDB (a Redis-based graph database).
Translate the user's natural language question into a valid Cypher query.

${SCHEMA_DESCRIPTION}

${CYPHER_RULES}

${CYPHER_COT}

## User Question:
"${query}"`,
      };

    case 'schema-aware':
      return {
        prompt: `You are a Cypher query expert for FalkorDB (a Redis-based graph database).
Translate the user's natural language question into a valid Cypher query.

${SCHEMA_DESCRIPTION}

${CYPHER_RULES}

${CYPHER_SCHEMA_AWARE}

## User Question:
"${query}"

Generate a Cypher query that answers this question.`,
      };

    case 'negative-examples':
      return {
        prompt: `You are a Cypher query expert for FalkorDB (a Redis-based graph database).
Translate the user's natural language question into a valid Cypher query.

${SCHEMA_DESCRIPTION}

${CYPHER_RULES}

${CYPHER_NEGATIVE}

## User Question:
"${query}"

Generate a Cypher query that answers this question.`,
      };

    case 'compressed':
      return {
        prompt: `Cypher expert. FalkorDB. Read-only queries only. Use toLower()+CONTAINS for names. LIMIT 50.

Nodes: File{name,filePath}, Function{name,filePath,startLine,signature,complexity}, Class{name,filePath,isExported}, Interface{name,filePath}, Variable{name,filePath}, Component{name,filePath}, Entity{text,type}
Edges: CONTAINS(File→*), CALLS(Func→Func), IMPORTS(File→File), EXTENDS(Class→Class), IMPLEMENTS(Class→Interface), HAS_METHOD(Class→Func), RENDERS(Comp→Comp), USES_HOOK(Comp→Func), ABOUT(Entity→*)

Q: "${query}"`,
      };

    case 'system-user-split':
      return {
        system: `You are a Cypher query expert for FalkorDB (a Redis-based graph database).
Only generate READ queries. Always use toLower() + CONTAINS for name matching. Limit to 50.

${SCHEMA_DESCRIPTION}

${CYPHER_RULES}`,
        prompt: `Generate a Cypher query for this question: "${query}"`,
      };

    case 'combined-best':
      return {
        system: `You are a Cypher query expert for FalkorDB (a Redis-based graph database).
Only generate READ queries. Always use toLower() + CONTAINS for name matching. Limit to 50.

${SCHEMA_DESCRIPTION}

${CYPHER_RULES}

${CYPHER_NEGATIVE}

${CYPHER_SCHEMA_AWARE}`,
        prompt: `${CYPHER_FEW_SHOT}

## User Question:
"${query}"

Generate a Cypher query that answers this question.`,
      };
  }
}

// ---- GRAPH_ANSWER variants ----

const ANSWER_FEW_SHOT = `## Examples:

Example 1:
Context: [Function] processPayment (src/payments/handler.ts:42) → Called by: checkout
Question: "What does processPayment do?"
Answer: "processPayment is a function in the payments handler (src/payments/handler.ts, line 42) that handles payment processing. It is called by the checkout function."

Example 2:
Context: [Class] UserService (src/services/user.ts:10) → Has methods: getUser, updateUser, deleteUser
Question: "How is user data managed?"
Answer: "User data is managed through the UserService class (src/services/user.ts:10) which provides getUser, updateUser, and deleteUser methods."`;

const ANSWER_COT = `Before answering, think step by step:
1. Identify which nodes in the context are most relevant to the question
2. Trace relationships between those nodes
3. Synthesize a concise answer referencing specific names and file paths
4. Assess confidence: how much of the question is answerable from this context?`;

const ANSWER_SCHEMA_AWARE = `## Expected Output:
- "answer": Natural language answer referencing specific names, file paths, and line numbers. If insufficient context, say so.
- "confidence": Number 0-1. 0.9+ = fully answerable, 0.5-0.8 = partial, below 0.5 = insufficient.
- "sources": Array of {nodeType, name, relevance} — include 1-5 most relevant source nodes.`;

const ANSWER_NEGATIVE = `## Mistakes to AVOID:
- DO NOT invent information not present in the context
- DO NOT ignore file paths and line numbers — always include them
- DO NOT give confidence above 0.8 if the context only partially answers the question
- DO NOT list every node as a source — only the most relevant ones`;

function buildGraphAnswerVariant(technique: Technique, query: string, context: string): PromptVariant {
  switch (technique) {
    case 'baseline':
      return {
        prompt: `You are a code assistant that answers questions about a software codebase.
Use ONLY the information from the graph context below to answer the question.
If the context doesn't contain enough information, say so honestly.

## Graph Context (nodes and relationships found in the codebase)
${context}

## Question
${query}

Answer the question based on the graph context. Include specific names, file paths, and relationships when available.`,
      };

    case 'few-shot':
      return {
        prompt: `You are a code assistant that answers questions about a software codebase.
Use ONLY the information from the graph context below to answer the question.

${ANSWER_FEW_SHOT}

## Graph Context
${context}

## Question
${query}

Answer the question based on the graph context.`,
      };

    case 'chain-of-thought':
      return {
        prompt: `You are a code assistant that answers questions about a software codebase.
Use ONLY the information from the graph context below.

${ANSWER_COT}

## Graph Context
${context}

## Question
${query}`,
      };

    case 'schema-aware':
      return {
        prompt: `You are a code assistant that answers questions about a software codebase.
Use ONLY the information from the graph context below.

${ANSWER_SCHEMA_AWARE}

## Graph Context
${context}

## Question
${query}`,
      };

    case 'negative-examples':
      return {
        prompt: `You are a code assistant that answers questions about a software codebase.
Use ONLY the information from the graph context below.

${ANSWER_NEGATIVE}

## Graph Context
${context}

## Question
${query}

Answer the question based on the graph context.`,
      };

    case 'compressed':
      return {
        prompt: `Code assistant. Answer ONLY from context. Include file paths.

Context:
${context}

Q: ${query}`,
      };

    case 'system-user-split':
      return {
        system: `You are a code assistant answering questions about a software codebase. Use ONLY the provided graph context. Include specific names, file paths, and relationships. If context is insufficient, say so.`,
        prompt: `## Graph Context
${context}

## Question
${query}`,
      };

    case 'combined-best':
      return {
        system: `You are a code assistant answering questions about a software codebase. Use ONLY the provided graph context. Include specific names, file paths, and relationships.

${ANSWER_NEGATIVE}

${ANSWER_SCHEMA_AWARE}`,
        prompt: `${ANSWER_FEW_SHOT}

## Graph Context
${context}

## Question
${query}`,
      };
  }
}

// ---- CONTEXT_WALK variants ----

const WALK_FEW_SHOT = `## Examples:

Example 1 (should expand — only 2 nodes, question not answered):
Question: "How does authentication work?"
Discovered: [Class] AuthService, [Function] validateToken
History: Round 0 found 2 nodes
Decision: action=expand, expandTarget="AuthService", reasoning="Need to find what AuthService calls and how validateToken is used", confidence=0.3

Example 2 (should answer — 8 nodes, full component tree found):
Question: "What components render the dashboard?"
Discovered: Dashboard, DashboardHeader, DashboardChart, DashboardTable, App→Dashboard
History: Round 0 found Dashboard, Round 1 expanded to find all child components
Decision: action=answer, answer="The Dashboard component renders DashboardHeader, DashboardChart, and DashboardTable. App renders Dashboard at the top level.", confidence=0.9`;

const WALK_COT = `Think step by step before deciding:
1. What is the question asking for?
2. How much of the answer is covered by the discovered nodes?
3. Are there obvious gaps — important nodes or relationships not yet explored?
4. If gaps exist, which node would fill them most efficiently?
5. If confidence >= 0.8, choose "answer" and provide your synthesis`;

const WALK_SCHEMA_AWARE = `## Expected Output:
- "action": One of "expand", "refine", or "answer"
- "expandTarget": (only if action=expand) Name of a specific node to explore
- "refinedQuery": (only if action=refine) A more specific search query
- "answer": (only if action=answer) Your synthesized answer
- "reasoning": Brief explanation of why you chose this action
- "confidence": 0.0-1.0 how sufficient the current context is to answer`;

const WALK_NEGATIVE = `## Mistakes to AVOID:
- DO NOT choose "answer" with confidence below 0.7 — keep exploring
- DO NOT choose "expand" without specifying a concrete expandTarget
- DO NOT repeat an expand target already explored in the walk history
- DO NOT refine to a completely unrelated query — stay close to the original`;

function buildContextWalkVariant(technique: Technique, query: string, context: string, history: string[]): PromptVariant {
  const historyStr = history.join('\n');

  switch (technique) {
    case 'baseline':
      return {
        prompt: `You are a graph exploration agent investigating a codebase knowledge graph.
Your goal is to answer the user's question by iteratively exploring the graph.

## User Question:
"${query}"

## Walk History:
${historyStr}

## Currently Discovered Context:
${context}

## Choose your next action:
- "expand": Search for more related nodes by specifying an expandTarget (a node name or pattern to explore)
- "refine": Re-search with a more specific query using refinedQuery
- "answer": You have enough context to answer the question — provide your answer

Also provide a "confidence" score (0.0 to 1.0) estimating how sufficient the current context is to answer the question. Choose "answer" when confidence is 0.8 or higher.`,
      };

    case 'few-shot':
      return {
        prompt: `You are a graph exploration agent investigating a codebase knowledge graph.

${WALK_FEW_SHOT}

## User Question:
"${query}"

## Walk History:
${historyStr}

## Currently Discovered Context:
${context}

## Choose your next action:
- "expand": Explore neighbors of a specific node (set expandTarget)
- "refine": Re-search with a better query (set refinedQuery)
- "answer": Synthesize your answer (set answer)

Provide confidence 0.0-1.0. Choose "answer" when confidence >= 0.8.`,
      };

    case 'chain-of-thought':
      return {
        prompt: `You are a graph exploration agent investigating a codebase knowledge graph.

${WALK_COT}

## User Question:
"${query}"

## Walk History:
${historyStr}

## Currently Discovered Context:
${context}

Choose expand, refine, or answer.`,
      };

    case 'schema-aware':
      return {
        prompt: `You are a graph exploration agent investigating a codebase knowledge graph.

${WALK_SCHEMA_AWARE}

## User Question:
"${query}"

## Walk History:
${historyStr}

## Currently Discovered Context:
${context}

Choose your next action.`,
      };

    case 'negative-examples':
      return {
        prompt: `You are a graph exploration agent investigating a codebase knowledge graph.

${WALK_NEGATIVE}

## User Question:
"${query}"

## Walk History:
${historyStr}

## Currently Discovered Context:
${context}

Choose expand, refine, or answer. Provide confidence 0.0-1.0.`,
      };

    case 'compressed':
      return {
        prompt: `Graph explorer. Goal: answer question by iterating.
Actions: expand(target), refine(query), answer(text). Confidence 0-1. Answer when >= 0.8.

Q: "${query}"
History: ${historyStr}
Context: ${context}

Choose action.`,
      };

    case 'system-user-split':
      return {
        system: `You are a graph exploration agent investigating a codebase knowledge graph.
Choose: expand (explore neighbors of a node), refine (re-search with better query), or answer (synthesize answer).
Provide confidence 0-1. Choose "answer" when confidence >= 0.8.`,
        prompt: `## Question: "${query}"

## Walk History:
${historyStr}

## Discovered Context:
${context}

Choose your next action.`,
      };

    case 'combined-best':
      return {
        system: `You are a graph exploration agent investigating a codebase knowledge graph.
Choose: expand, refine, or answer. Provide confidence 0-1. Answer when >= 0.8.

${WALK_NEGATIVE}

${WALK_SCHEMA_AWARE}`,
        prompt: `${WALK_FEW_SHOT}

## Question: "${query}"

## Walk History:
${historyStr}

## Discovered Context:
${context}

Choose your next action.`,
      };
  }
}

// ---- ROUTING variants ----

const ROUTE_STRATEGIES = `## Available Strategies:
- HYBRID: Simple lookups by name, keyword, or concept (e.g., "sendEmail", "auth module")
- GRAPH_ANSWER: Questions that need an explanation or synthesis (e.g., "What does X do?", "Who created Y?")
- NL_TO_CYPHER: Structural queries about relationships (e.g., "Find all functions that call X", "List classes extending Y")
- CONTEXT_WALK: Complex multi-hop exploration (e.g., "How does data flow from X to Y?", "Trace the call chain from A to B")`;

const ROUTE_FEW_SHOT = `## Examples:
Q: "parseCode" → strategy: HYBRID (simple symbol lookup)
Q: "What does the indexer do?" → strategy: GRAPH_ANSWER (needs explanation)
Q: "List all classes that implement SearchStrategy" → strategy: NL_TO_CYPHER (structural query)
Q: "Trace data flow from API to database" → strategy: CONTEXT_WALK (multi-hop exploration)`;

const ROUTE_COT = `Think step by step:
1. Is this a simple name/keyword lookup? → HYBRID
2. Is this asking for an explanation or understanding? → GRAPH_ANSWER
3. Is this asking about relationships, counts, or graph structure? → NL_TO_CYPHER
4. Is this asking about paths, flows, or multi-step connections? → CONTEXT_WALK`;

const ROUTE_SCHEMA_AWARE = `## Expected Output:
- "strategy": One of VECTOR, HYBRID, GRAPH_ANSWER, NL_TO_CYPHER, CONTEXT_WALK
- "reasoning": One sentence explaining why this strategy fits
- "rewrittenQuery": (optional) Improved query for the chosen strategy`;

const ROUTE_NEGATIVE = `## Mistakes to AVOID:
- DO NOT route single-word symbol lookups (e.g., "sendEmail") to GRAPH_ANSWER — use HYBRID
- DO NOT route "find all X that Y" structural queries to GRAPH_ANSWER — use NL_TO_CYPHER
- DO NOT route "what does X do?" to NL_TO_CYPHER — use GRAPH_ANSWER
- DO NOT route to CONTEXT_WALK unless the query involves paths, flows, chains, or traces`;

function buildRoutingVariant(technique: Technique, query: string): PromptVariant {
  switch (technique) {
    case 'baseline':
      return {
        prompt: `You are a search router for a code knowledge graph. Classify the user's query and choose the best search strategy.

${ROUTE_STRATEGIES}

## User Query:
"${query}"

Choose the best strategy and optionally rewrite the query for better results.`,
      };

    case 'few-shot':
      return {
        prompt: `You are a search router for a code knowledge graph.

${ROUTE_STRATEGIES}

${ROUTE_FEW_SHOT}

## User Query:
"${query}"

Choose the best strategy.`,
      };

    case 'chain-of-thought':
      return {
        prompt: `You are a search router for a code knowledge graph.

${ROUTE_STRATEGIES}

${ROUTE_COT}

## User Query:
"${query}"`,
      };

    case 'schema-aware':
      return {
        prompt: `You are a search router for a code knowledge graph.

${ROUTE_STRATEGIES}

${ROUTE_SCHEMA_AWARE}

## User Query:
"${query}"

Choose the best strategy.`,
      };

    case 'negative-examples':
      return {
        prompt: `You are a search router for a code knowledge graph.

${ROUTE_STRATEGIES}

${ROUTE_NEGATIVE}

## User Query:
"${query}"

Choose the best strategy.`,
      };

    case 'compressed':
      return {
        prompt: `Route to: HYBRID(lookup), GRAPH_ANSWER(explain), NL_TO_CYPHER(structure), CONTEXT_WALK(flow).

Q: "${query}"`,
      };

    case 'system-user-split':
      return {
        system: `You are a search router for a code knowledge graph.
${ROUTE_STRATEGIES}`,
        prompt: `Classify this query and choose the best strategy: "${query}"`,
      };

    case 'combined-best':
      return {
        system: `You are a search router for a code knowledge graph.
${ROUTE_STRATEGIES}
${ROUTE_NEGATIVE}
${ROUTE_SCHEMA_AWARE}`,
        prompt: `${ROUTE_FEW_SHOT}

## User Query:
"${query}"

Choose the best strategy.`,
      };
  }
}

// =============================================================================
// Quality Scoring
// =============================================================================

async function scoreNLToCypher(
  output: { cypher: string; explanation: string; parametersJson?: string },
  testCase: TestCase,
  client: any,
): Promise<number> {
  if (/\b(CREATE|SET|DELETE|MERGE|REMOVE|DROP)\b/i.test(output.cypher)) return 0;
  try {
    let params: Record<string, unknown> = {};
    if (output.parametersJson) {
      try { params = JSON.parse(output.parametersJson); } catch { /* ignore */ }
    }
    const result = await client.roQuery(output.cypher, { params });
    const resultNames = result.data
      .flatMap((row: Record<string, unknown>) => Object.values(row))
      .filter((v: unknown) => typeof v === 'string') as string[];

    const expected = testCase.expectedNames ?? [];
    if (expected.length === 0) return result.data.length > 0 ? 100 : 0;

    let found = 0;
    for (const exp of expected) {
      if (resultNames.some((n: string) =>
        n.toLowerCase().includes(exp.toLowerCase()) ||
        exp.toLowerCase().includes(n.toLowerCase())
      )) {
        found++;
      }
    }
    return Math.round((found / expected.length) * 100);
  } catch {
    return 0;
  }
}

function scoreGraphAnswer(
  output: { answer: string; confidence: number },
  testCase: TestCase,
): number {
  const mentions = testCase.expectedMentions ?? [];
  if (mentions.length === 0) return output.answer.length > 20 ? 50 : 0;

  const answerLower = output.answer.toLowerCase();
  let found = 0;
  for (const m of mentions) {
    if (answerLower.includes(m.toLowerCase())) found++;
  }
  return Math.round((found / mentions.length) * 100);
}

function scoreContextWalk(
  output: { action: string; confidence?: number },
  testCase: TestCase,
): number {
  const expected = testCase.expectedActions ?? [];
  return expected.includes(output.action) ? 100 : 0;
}

function scoreRouting(
  output: { strategy: string },
  testCase: TestCase,
): number {
  if (output.strategy === testCase.expectedRoute) return 100;
  // Partial credit: GRAPH_ANSWER ↔ CONTEXT_WALK confusion is forgivable
  if (
    (testCase.expectedRoute === 'GRAPH_ANSWER' && output.strategy === 'CONTEXT_WALK') ||
    (testCase.expectedRoute === 'CONTEXT_WALK' && output.strategy === 'GRAPH_ANSWER')
  ) return 50;
  return 0;
}

// =============================================================================
// Runner
// =============================================================================

function buildPromptVariant(task: TaskType, technique: Technique, tc: TestCase): PromptVariant {
  switch (task) {
    case 'NL_TO_CYPHER': return buildNLToCypherVariant(technique, tc.query);
    case 'GRAPH_ANSWER': return buildGraphAnswerVariant(technique, tc.query, tc.mockContext!);
    case 'CONTEXT_WALK': return buildContextWalkVariant(technique, tc.query, tc.mockContext!, tc.mockWalkHistory!);
    case 'ROUTING': return buildRoutingVariant(technique, tc.query);
  }
}

function getSchemaForTask(task: TaskType) {
  switch (task) {
    case 'NL_TO_CYPHER': return NLToCypherSchema;
    case 'GRAPH_ANSWER': return GraphAnswerSchema;
    case 'CONTEXT_WALK': return ContextWalkStepSchema;
    case 'ROUTING': return SearchRouteSchema;
  }
}

async function runSingleTest(
  modelId: string,
  tc: TestCase,
  technique: Technique,
  round: number,
  client: any,
): Promise<BenchmarkResult> {
  const model = cerebras.chatModel(modelId);
  const variant = buildPromptVariant(tc.task, technique, tc);
  const schema = getSchemaForTask(tc.task);

  const start = Date.now();
  try {
    const args: Record<string, unknown> = {
      model,
      output: Output.object({ schema }),
      prompt: variant.prompt,
      temperature: 0.1,
      maxOutputTokens: tc.task === 'ROUTING' ? 200 : 500,
    };
    if (variant.system) {
      args.system = variant.system;
    }

    const result = await generateText(args);
    const latencyMs = Date.now() - start;
    const output = (result as any).output;

    let qualityScore = 0;
    if (tc.task === 'NL_TO_CYPHER') {
      qualityScore = await scoreNLToCypher(output, tc, client);
    } else if (tc.task === 'GRAPH_ANSWER') {
      qualityScore = scoreGraphAnswer(output, tc);
    } else if (tc.task === 'CONTEXT_WALK') {
      qualityScore = scoreContextWalk(output, tc);
    } else if (tc.task === 'ROUTING') {
      qualityScore = scoreRouting(output, tc);
    }

    return { task: tc.task, technique, model: modelId, testId: tc.id, round, latencyMs, qualityScore };
  } catch (err) {
    return {
      task: tc.task, technique, model: modelId, testId: tc.id, round,
      latencyMs: Date.now() - start, qualityScore: 0,
      error: err instanceof Error ? err.message.slice(0, 80) : String(err).slice(0, 80),
    };
  }
}

// =============================================================================
// Output Formatting
// =============================================================================

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 !== 0 ? sorted[mid]! : Math.round((sorted[mid - 1]! + sorted[mid]!) / 2);
}

function printTaskTable(task: TaskType, results: BenchmarkResult[]) {
  const taskResults = results.filter(r => r.task === task);
  if (taskResults.length === 0) return;

  console.log(`\n${'='.repeat(72)}`);
  console.log(`  ${task}`);
  console.log(`${'='.repeat(72)}`);

  const techW = 20;
  const cellW = 14;

  // Header
  let header = 'Technique'.padEnd(techW);
  for (const m of MODELS) header += `| ${MODEL_LABELS[m]!.padEnd(cellW - 2)} `;
  console.log(header);

  let subHeader = ''.padEnd(techW);
  for (const _m of MODELS) subHeader += `| ${'lat'.padStart(5)} ${'qual'.padStart(5)} `;
  console.log(subHeader);
  console.log('─'.repeat(techW + MODELS.length * cellW));

  for (const tech of TECHNIQUES) {
    let line = tech.padEnd(techW);
    for (const modelId of MODELS) {
      const runs = taskResults.filter(r => r.technique === tech && r.model === modelId);
      const good = runs.filter(r => !r.error);
      if (good.length === 0) {
        const errCount = runs.filter(r => r.error).length;
        line += `| ${'ERR'.padStart(5)}(${errCount})${''.padEnd(4)}`;
        continue;
      }
      const lat = median(good.map(r => r.latencyMs));
      const qual = Math.round(good.reduce((s, r) => s + r.qualityScore, 0) / good.length);
      line += `| ${(lat + 'ms').padStart(6)} ${(qual + '%').padStart(5)} `;
    }
    console.log(line);
  }
}

function printOverallSummary(results: BenchmarkResult[]) {
  console.log(`\n${'='.repeat(72)}`);
  console.log('  OVERALL — Average quality across all tasks');
  console.log(`${'='.repeat(72)}`);

  const techW = 20;
  let header = 'Technique'.padEnd(techW);
  for (const m of MODELS) header += `| ${MODEL_LABELS[m]!.padEnd(12)} `;
  console.log(header);
  console.log('─'.repeat(techW + MODELS.length * 14));

  for (const tech of TECHNIQUES) {
    let line = tech.padEnd(techW);
    for (const modelId of MODELS) {
      const runs = results.filter(r => r.technique === tech && r.model === modelId && !r.error);
      if (runs.length === 0) {
        line += `| ${'ERR'.padEnd(12)} `;
        continue;
      }
      const avgLat = Math.round(runs.reduce((s, r) => s + r.latencyMs, 0) / runs.length);
      const avgQual = Math.round(runs.reduce((s, r) => s + r.qualityScore, 0) / runs.length);
      line += `| ${(avgLat + 'ms').padStart(5)} ${(avgQual + '%').padStart(4)} `;
    }
    console.log(line);
  }
}

// =============================================================================
// Main
// =============================================================================

async function main() {
  console.log('=== Prompt Engineering A/B Benchmark ===');
  console.log(`Models: ${MODELS.map(m => MODEL_LABELS[m]).join(', ')}`);
  console.log(`Techniques: ${TECHNIQUES.length}`);
  console.log(`Test cases: ${TEST_CASES.length}`);
  console.log(`Rounds: ${ROUNDS}`);
  const totalCalls = TECHNIQUES.length * MODELS.length * TEST_CASES.length * ROUNDS;
  console.log(`Total API calls: ${totalCalls}\n`);

  // Connect to FalkorDB
  const client = await getGraphClient();
  const countResult = await client.roQuery('MATCH (n) RETURN count(n) AS cnt');
  const nodeCount = (countResult as any).data[0]?.cnt ?? 0;
  console.log(`FalkorDB: ${nodeCount} nodes\n`);

  if (nodeCount === 0) {
    console.error('ERROR: Graph is empty. Index first.');
    await closeGraphClient();
    process.exit(1);
  }

  const allResults: BenchmarkResult[] = [];
  const tasks: TaskType[] = ['NL_TO_CYPHER', 'GRAPH_ANSWER', 'CONTEXT_WALK', 'ROUTING'];

  for (const task of tasks) {
    const cases = TEST_CASES.filter(tc => tc.task === task);
    console.log(`\n--- ${task} (${cases.length} queries × ${TECHNIQUES.length} techniques × ${MODELS.length} models × ${ROUNDS} rounds) ---`);

    for (const tc of cases) {
      for (const technique of TECHNIQUES) {
        for (const modelId of MODELS) {
          for (let round = 1; round <= ROUNDS; round++) {
            const label = `${MODEL_LABELS[modelId]}`.padEnd(10);
            process.stdout.write(`  ${technique.padEnd(18)} ${label} ${tc.id.padEnd(10)} r${round} `);
            const result = await runSingleTest(modelId, tc, technique, round, client);
            allResults.push(result);

            const icon = result.error ? '✗' : result.qualityScore >= 50 ? '✓' : '○';
            console.log(`${icon} ${result.latencyMs}ms ${result.qualityScore}%${result.error ? ' ERR' : ''}`);

            // Small delay to avoid rate limit issues
            await new Promise(r => setTimeout(r, 100));
          }
        }
      }
    }
  }

  // Print summary tables per task
  for (const task of tasks) {
    printTaskTable(task, allResults);
  }

  // Print overall summary
  printOverallSummary(allResults);

  // Print error summary if any
  const errors = allResults.filter(r => r.error);
  if (errors.length > 0) {
    console.log(`\n⚠ ${errors.length} errors:`);
    for (const e of errors.slice(0, 10)) {
      console.log(`  ${MODEL_LABELS[e.model]} / ${e.technique} / ${e.testId}: ${e.error}`);
    }
    if (errors.length > 10) console.log(`  ... and ${errors.length - 10} more`);
  }

  await closeGraphClient();
  console.log('\nBenchmark complete.');
}

main().catch((err) => {
  console.error('Fatal:', err);
  process.exit(1);
});
