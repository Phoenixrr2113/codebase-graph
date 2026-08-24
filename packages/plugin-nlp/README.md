# @codegraph/plugin-nlp

Private workspace package for embeddings, optional reranking, natural-language entity extraction, document and conversation ingestion, entity resolution, and knowledge-to-code linking.

## Embeddings

| Provider | Default model | Dimensions | Selection |
| --- | --- | ---: | --- |
| `local` | `nomic-ai/nomic-embed-text-v1.5` | 768 | Automatic when no explicit provider or supported cloud key is configured |
| `voyage` | `voyage-code-3` | 1024 | Explicit provider or `VOYAGE_API_KEY` auto-detection |
| `openrouter` | `openai/text-embedding-3-small` | 1536 | Explicit provider or `OPENROUTER_API_KEY` auto-detection |
| `none` | No model | 0 | Explicit structural-only mode |

Resolution order is an explicit call-site provider, `CODEGRAPH_EMBEDDING_PROVIDER`, Voyage key, OpenRouter key, then local. Valid provider values are `local`, `voyage`, `openrouter`, and `none`.

The local model downloads automatically on first use and runs through `@huggingface/transformers`. Cloud embedding requests are cached within the process.

## Persisted profile and migration

CodeGraph persists the selected provider, model, and vector dimension with the graph schema. If the requested profile differs from the stored profile, setup reports `migration-required` and graph mutation is blocked. An explicit re-embed migration or full reindex is required before writes continue. This applies even when two models happen to share a dimension.

## Reranking

Voyage reranking is optional and resolves only when a supported provider and key are available. Without one, search keeps fallback scores and reports the unavailable reranker rather than failing retrieval. `CODEGRAPH_RERANK=false` disables reranking explicitly.

Jina is not supported. `CODEGRAPH_RERANK_PROVIDER=jina` is rejected with guidance to use Voyage.

## Other modules

- LLM factories for Cerebras, GLM, OpenRouter, and local Ollama-compatible endpoints
- entity, relationship, and fact extraction from text
- document chunking and ingestion
- conversation parsing with speaker attribution
- exact, embedding-assisted, and LLM-assisted entity resolution
- conflict detection for knowledge facts
- `ABOUT` linking from knowledge entities to code by name or embedding similarity

LLM-backed extraction requires a configured LLM provider. Embedding generation does not require an API key because local is the automatic no-key default.
