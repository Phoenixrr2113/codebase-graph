# @codegraph/plugin-nlp

Natural language processing for CodeGraph. Handles entity extraction, embeddings, knowledge graph operations, conversation ingestion, and bridge linking between knowledge and code entities.

## Overview

This package provides the NLP pipeline that powers CodeGraph's knowledge graph and semantic search capabilities. It extracts entities and relationships from natural language text using LLMs, generates embeddings for semantic similarity, and links knowledge entities to code entities in the graph.

## Key Modules

### LLM Integration

- **`getLLMModel` / `getLLMComplexModel`** — Multi-provider LLM factory (Cerebras, GLM, OpenRouter, Ollama)
- **`isLLMAvailable`** — Check if an LLM provider is configured
- Two-tier model system: default (fast inference) and complex (multi-step reasoning)
- Uses Vercel AI SDK v6 (`generateText`, `generateObject`) with Zod schemas
- Cerebras and GLM use `@ai-sdk/openai-compatible`; OpenRouter uses `@openrouter/ai-sdk-provider`; Ollama uses `@ai-sdk/openai-compatible` pointed at localhost
- Built-in retry with exponential backoff for transient errors (429, 5xx, network)

### Entity Extraction

- **`EntityExtractor`** — LLM-powered extraction of entities, relationships, and facts from text
- **Schemas**: `ExtractionResponseSchema`, `BatchExtractionResponseSchema`
- **`extractAndStore` / `extractAndStoreBatch`** — Extract from text and persist to graph
- **`extractConversation` / `ingestConversation`** — Episodic extraction from multi-turn conversations

### Embeddings

Three-tier embedding strategy:

| Tier | Provider | Model | Dimensions | Notes |
|------|----------|-------|-----------|-------|
| **Local** | `local` | `nomic-ai/nomic-embed-text-v1.5` (ONNX, q8) | 768 | ~10ms/batch, auto-downloads ~140MB on first use |
| **Cloud** | `openrouter` | `openai/text-embedding-3-small` | 1536 | Via OpenRouter API |
| **Voyage** | `voyage` | `voyage-code-3` | 1024 | Code-optimized, supports query/document input types |

- **`generateEmbedding` / `generateEmbeddings`** — Generate embeddings with automatic tier selection
- Local embeddings use `@huggingface/transformers` with CPU inference (ONNX runtime)
- Cloud embeddings are cached (up to 1000 entries) to avoid redundant API calls
- Embedding text builders for: Function, Class, Interface, Component, Type, Variable, File

### Reranker

Cross-encoder reranking for search results. Auto-detects provider from available API keys.

| Provider | Default Model | API Key Env |
|----------|---------------|-------------|
| **Voyage** | `rerank-2` | `VOYAGE_API_KEY` |
| **Jina** | `jina-reranker-v2-base-multilingual` | `JINA_API_KEY` |

- **`rerank`** — Rerank documents by relevance to a query
- **`isRerankAvailable`** — Check if a reranker provider is available
- Graceful degradation: returns original order if no provider is configured or API fails
- Auto-detects from API keys; overridable via `CODEGRAPH_RERANK_PROVIDER` and `CODEGRAPH_RERANK_MODEL` env vars
- Disable entirely with `CODEGRAPH_RERANK=false`

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

### LLM (required for entity extraction)

```env
# Provider selection (default: cerebras if key present, else openrouter)
LLM_PROVIDER=cerebras          # cerebras | glm | openrouter | ollama
LLM_MODEL=                     # model name override (default: provider-specific)

# Cerebras (default, fast inference)
CEREBRAS_API_KEY=your-key
CEREBRAS_MODEL=qwen-3-235b-a22b-instruct-2507  # default

# GLM (deep reasoning)
GLM_API_KEY=your-key
GLM_MODEL=GLM-4.7              # default

# OpenRouter
OPENROUTER_API_KEY=your-key    # default model: google/gemini-2.5-flash

# Ollama (local)
OLLAMA_BASE_URL=http://localhost:11434/v1  # default

# Complex model tier (defaults to same as LLM_PROVIDER)
COMPLEX_LLM_PROVIDER=          # override provider for complex reasoning
COMPLEX_LLM_MODEL=             # override model for complex tier
```

### Embeddings

Auto-detects provider from API keys. Set `CODEGRAPH_EMBEDDING_PROVIDER` only to override.

```env
VOYAGE_API_KEY=your-key              # → voyage embeddings (1024-dim)
OPENROUTER_API_KEY=your-key          # → openrouter embeddings (1536-dim)
# No API key                         # → set CODEGRAPH_EMBEDDING_PROVIDER=local for local (768-dim)
CODEGRAPH_EMBEDDING_PROVIDER=        # optional override: local | openrouter | voyage
CODEGRAPH_EMBEDDING_MODEL=           # optional model override
```

### Reranker

Auto-detects provider from API keys. Set `CODEGRAPH_RERANK_PROVIDER` only to override.

```env
JINA_API_KEY=your-key           # → jina reranker
VOYAGE_API_KEY=your-key         # → voyage reranker (if no JINA_API_KEY)
CODEGRAPH_RERANK_PROVIDER=      # optional override: jina | voyage
CODEGRAPH_RERANK_MODEL=         # optional model override
CODEGRAPH_RERANK=false          # set to disable reranking entirely
```

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
