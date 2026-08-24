# CGBench v1

CGBench is the repository's reproducible TypeScript harness for measuring retrieval quality, latency, ingestion, and resource use across code-knowledge systems.

## Current committed results

Start with [BENCHMARKS.md](BENCHMARKS.md) for methodology, caveats, system status, and the smoke comparison. The committed result directories preserve the source reports and machine-readable summaries for later runs.

- [`results/v0.1.4-final/`](results/v0.1.4-final/) is the four-corpus CodeGraph baseline with 112 completed question dispatches across TypeScript zod, Python requests, Go chi, and Rust clap.
- [`results/v0.1.5-glm51/`](results/v0.1.5-glm51/) repeats that four-corpus method with a different entity-extraction LLM. Its report records one dropped knowledge-ingest dispatch and 111 successful dispatches.
- [`results/v0.1.0-smoke/`](results/v0.1.0-smoke/) contains the small cross-system smoke fixture. Its sample size is not a production ranking.

Read the report inside a result directory before comparing numbers. Several runs are single-system, task sample sizes are small, and LLM-backed ingestion introduces run-to-run variance.

## Task battery

| Task | Production adapter path | Measurement |
| --- | --- | --- |
| A, natural language to code | `search.find` | Symbol retrieval |
| B, multi-hop | `search.find` | Partial vector recall |
| C, dependency | `search.find` | Partial vector recall |
| D, temporal | `knowledge.query_knowledge` | Point-in-time and range recall |
| E, cross-modal | `search.find` with `searchScope=all` | Code and knowledge fusion |
| F, document | `knowledge.query_knowledge` | Document retrieval |

Tasks B and C deliberately do not synthesize Cypher. Structural traversal is available through the `query` MCP tool, while these benchmark tasks measure what the production search path retrieves without a hand-written graph query.

## Requirements

- Node.js 20 or newer
- Workspace dependencies installed from the repository root
- Git for cloning pinned code corpora
- Provider credentials or local services required by the particular adapter being run

FalkorDBLite uses the platform binaries installed with the workspace. It does not require a separate `redis-server` installation. Keep temporary result paths short on macOS because embedded storage uses a Unix socket; `/tmp/cgbench-results` is a suitable location.

## Validate the harness

From the repository root:

```bash
pnpm --filter @codegraph/cgbench-v1 test
```

The package scripts also expose corpus cloning, document rendering, integration tests, competitor tests, type checking, and the `bench` CLI. Real-corpus reports record their exact adapter, corpus, model, provider, source revision, command, and caveats inside the corresponding result directory.
