# @codegraph/plugin-nlp

Natural language processing for CodeGraph. Handles entity extraction, embeddings, knowledge graph operations, conversation ingestion, and bridge linking between knowledge and code entities.

## Overview

This package provides the NLP pipeline that powers CodeGraph's knowledge graph and semantic search capabilities. It extracts entities and relationships from natural language text using LLMs, generates embeddings for semantic similarity, and links knowledge entities to code entities in the graph.

## Key Modules

### LLM Integration

- **`getLLMModel` / `getLLMComplexModel`** — Multi-provider LLM factory (OpenRouter, Ollama)
- **`isLLMAvailable`** — Check if an LLM provider is configured
- Uses Vercel AI SDK v6 (`generateText`, `generateObject`) with Zod schemas

### Entity Extraction

- **`EntityExtractor`** — LLM-powered extraction of entities, relationships, and facts from text
- **Schemas**: `ExtractionResponseSchema`, `GraphAnswerSchema`, `NLToCypherSchema`, `SearchRouteSchema`, `ContextWalkStepSchema`
- **`extractAndStore` / `extractAndStoreBatch`** — Extract from text and persist to graph
- **`extractConversation` / `ingestConversation`** — Episodic extraction from multi-turn conversations

### Embeddings

Two-tier embedding strategy:

| Tier | Model | Dimensions | Speed |
|------|-------|-----------|-------|
| **Local** | `nomic-ai/nomic-embed-text-v1.5` (ONNX) | 768 | ~10ms/batch |
| **Cloud** | OpenRouter (configurable) | varies | network-dependent |

- **`generateEmbedding` / `generateEmbeddings`** — Generate embeddings with automatic tier selection
- Local embeddings use `@huggingface/transformers` v3.8.1 with CPU inference
- Embedding text builders for: Function, Class, Interface, Component, Type, Variable, File

### Bridge Linking

- **`linkEntitiesToCode`** — Link knowledge entities to code entities by name matching
- **`linkByEmbedding`** — Link knowledge entities to code entities by vector similarity
- Creates ABOUT edges connecting knowledge to the relevant code

### Entity Resolution

- **`resolveEntities`** — Merge duplicate entities using embedding similarity
- Pairwise comparison with configurable similarity threshold

### Conflict Resolution

- **`checkAndResolveConflicts`** — Detect and resolve conflicting facts in the knowledge graph

### Conversation Processing

- **`chunkConversation`** — Split conversations into meaningful chunks for extraction
- **`ingestConversation`** — Full pipeline: chunk → extract → store → link

## Usage

```typescript
import {
  generateEmbedding,
  extractAndStore,
  ingestConversation,
  linkEntitiesToCode,
  getLLMModel,
} from '@codegraph/plugin-nlp';

// Generate embeddings
const embedding = await generateEmbedding('authentication middleware');

// Extract entities from text
await extractAndStore(knowledgeOps, 'The auth service validates JWT tokens using RS256');

// Ingest a conversation
await ingestConversation(knowledgeOps, graphOps, conversationMessages);

// Link knowledge to code
await linkEntitiesToCode(knowledgeOps, graphOps);
```

## Configuration

Requires at least one LLM provider for entity extraction:

```env
# OpenRouter (recommended)
OPENROUTER_API_KEY=your-key

# Or Ollama (local)
OLLAMA_HOST=http://localhost:11434
OLLAMA_MODEL=llama3
```

Embeddings work without any configuration (local model auto-downloads on first use).

## Tests

12 test files covering:
- Entity extraction (unit + live LLM)
- Embedding generation (local + cloud)
- Bridge linking
- Conversation chunking and ingestion
- Entity resolution
- Conflict resolution
- Episodic extraction
- LLM factory
- Embedding text builders

```bash
cd packages/plugin-nlp
pnpm exec vitest run
```
