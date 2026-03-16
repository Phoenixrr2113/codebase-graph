# Multi-Codebase Benchmark — 2026-03-16

Label: `blended-reranker`

## Indexing (8 projects)

| Project | Files | Entities | Edges | Embedded | Errors | Time |
|---------|------:|--------:|------:|---------:|-------:|-----:|
| codebase-graph | 384 | 9,325 | 11,625 | 2,081 | 0 | 25.4s |
| Sitecore-MCP | 29 | 574 | 977 | 82 | 0 | 12.0s |
| agntK | 283 | 6,003 | 7,529 | 1,350 | 0 | 14.6s |
| capsule-corp | 98 | 1,224 | 1,342 | 130 | 0 | 2.9s |
| feature-spec-app | 386 | 6,374 | 8,145 | 1,293 | 0 | 11.1s |
| phantom | 61 | 2,078 | 2,495 | 280 | 0 | 4.2s |
| sweet-revenge | 499 | 7,876 | 9,986 | 1,464 | 0 | 12.9s |
| life-guardian | 48 | 787 | 1,022 | 139 | 0 | 3.0s |
| **Total** | **1,788** | **34,241** | **43,121** | **6,819** | **0** | **86.0s** |

- Files/sec: 20.8
- ms/embed: 12.6
- Embedding provider: Voyage voyage-code-3 (1024-dim)
- Entity filtering: Files, Variables, docstring-less Types, trivial Functions skipped

## Graph Node Counts

| Label | Count |
|-------|------:|
| Variable | 16,380 |
| Function | 5,328 |
| File | 2,428 |
| Section | 1,947 |
| Interface | 1,247 |
| CodeBlock | 541 |
| Type | 527 |
| Link | 217 |
| Component | 157 |
| MarkdownDocument | 92 |
| Class | 85 |
| Project | 8 |

## Search Quality (15 queries)

| Query | Hits | Latency | Top Hit | Projects |
|-------|-----:|--------:|---------|----------|
| createClient | 8 | 399ms | createClient (client.ts) | codebase-graph, agntK, capsule-corp |
| index | 10 | 418ms | IndexResult (indexer.ts) | codebase-graph, feature-spec-app |
| config | 10 | 499ms | AppConfig (loader.ts) | life-guardian, agntK, capsule-corp |
| Router | 10 | 416ms | getOpenRouter (extractor.ts) | agntK, codebase-graph, capsule-corp, feature-spec-app, sweet-revenge |
| middleware | 10 | 423ms | createAuthMiddleware (middleware.ts) | agntK, feature-spec-app |
| auth | 10 | 403ms | AuthHelper (auth-helpers.ts) | feature-spec-app, sweet-revenge, life-guardian, agntK, capsule-corp |
| database | 10 | 398ms | DATABASE_URL (env.ts) | feature-spec-app, codebase-graph, sweet-revenge |
| handleRequest | 6 | 398ms | handleRequestInfo (product-card.tsx) | sweet-revenge, codebase-graph, agntK |
| parse | 10 | 556ms | ParseOptions (parseService.ts) | codebase-graph, agntK |
| test | 10 | 650ms | TESTS (benchmark-cerebras-models.ts) | codebase-graph, feature-spec-app, sweet-revenge, agntK, life-guardian |
| how does authentication work | 10 | 406ms | 1772057534_created_workflow_runs.js | capsule-corp |
| error handling patterns | 10 | 453ms | ERROR_PATTERNS (error-messages.ts) | feature-spec-app, codebase-graph, agntK, Sitecore-MCP |
| API endpoint definitions | 10 | 466ms | ApiEnvelope (api.ts) | codebase-graph, phantom, agntK |
| data validation logic | 10 | 377ms | ChartData (dashboard.ts) | sweet-revenge, agntK, feature-spec-app |
| state management | 10 | 499ms | EmptyState (EmptyState.tsx) | feature-spec-app, codebase-graph, agntK, sweet-revenge |

### Search Summary

| Metric | Value |
|--------|-------|
| Queries | 15 |
| Avg hits | 9.6 |
| Avg latency | 451ms |
| Multi-project queries | 14/15 (93%) |
| Zero-hit queries | 0 |

## Single-Codebase Benchmark (codebase-graph only)

| Metric | Value |
|--------|-------|
| Tests | 783 |
| Passed | 780 (99.6%) |
| Failed | 3 |
| Top-1 accuracy | 95.9% |
| MRR | 0.976 |
| Avg latency | 78ms |

### By Difficulty

| Difficulty | Top-1 | MRR |
|------------|------:|----:|
| easy (260) | 100% | 1.00 |
| medium (151) | 88% | 0.93 |
| hard (71) | 97% | 0.98 |

### By Category

| Category | N | Top-1 | MRR | P50 | P95 |
|----------|--:|------:|----:|----:|----:|
| Fulltext Search | 82 | 84% | 0.90 | 186ms | 473ms |
| Search Strategies | 23 | 100% | 1.00 | 179ms | 5182ms |

## Configuration

- Driver: FalkorDB (Docker, arm64)
- Embeddings: Voyage voyage-code-3 (1024-dim)
- Reranker: Blended (60% RRF + 40% Voyage rerank-2), only fires when 5+ candidates from both vector and text
- minRRFScore: 0.4 (same threshold with or without reranker)
