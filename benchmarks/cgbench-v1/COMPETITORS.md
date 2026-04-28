# CGBench v1 — Competitors Discovery

This document captures what is known about each competitor at the time of Plan 3 implementation. Plan 4 will reflect any updates discovered during real benchmark runs.

## Status legend

- **READY**: implementable and smoke-testable in this environment, no external accounts required
- **READY-WITH-KEY**: needs an API key the user has indicated they will provide
- **BLOCKED**: requires a paid account or cloud setup we do not have
- **DEFERRED**: insufficient information; investigate during Plan 3 implementation

---

## 1. mcp-codebase-index

- Repo: https://github.com/MikeRecognex/mcp-codebase-index
- License: **AGPL-3.0** (with commercial license option for proprietary embedding)
- MCP server: **yes** — ships as a PyPI package with a `mcp-codebase-index` console script and `python -m mcp_codebase_index.server` entry point
- Setup: `pip install "mcp-codebase-index[mcp]"`
- API keys: **none** — entirely local, zero runtime cloud dependencies
- Local runnable: **YES**
- Plan 3 status: **READY**
- Best ingest API: MCP tool `get_project_summary` triggers indexing; incremental re-index via `git diff` on subsequent calls
- Best query API: `search_codebase` (semantic), `find_symbol`, `get_function_source`, `get_class_source`, `get_dependencies`, `get_call_chain` — 18 tools total
- Quirks:
  - Python 3.11+ required
  - Persistent disk cache eliminates cold-start penalties on second run — benchmark must account for warm vs cold timing
  - Sub-millisecond query responses; response size scales with answer, not codebase size (tested on CPython at 1.1M lines)
  - AGPL-3.0 means redistribution of modified versions requires source publication; running in a private benchmark is fine
  - **CODE-ONLY**: does not ingest `knowledgeRoot` or `documentRoot`; Tasks D, E, and F will score 0 — expected by design

---

## 2. Cognee

- Repo: https://github.com/topoteretes/cognee
- MCP sub-repo: https://github.com/topoteretes/cognee/tree/main/cognee-mcp
- License: **Apache-2.0**
- MCP server: **yes** — `cognee-mcp` subdirectory with stdio/SSE/HTTP transports; source-clone install only (not on PyPI as a standalone package)
- Setup:
  ```bash
  # Python SDK (PyPI)
  pip install cognee             # latest: 1.0.3 (2026-04-24)
  # MCP server (source)
  git clone https://github.com/topoteretes/cognee
  cd cognee/cognee-mcp && pip install uv && uv sync --dev --all-extras --reinstall
  source .venv/bin/activate && python src/server.py
  ```
- API keys: **none** — uses local Ollama; no external accounts or API keys required
- Local runnable: **YES** (Ollama required; default model `qwen3.5:9b`)
- Plan 3 status: **READY-WITH-KEY** (original)
- Plan 5 status: **WORKING (smoke); batch run-all crash deferred to v0.1.2**. Standalone smoke against tiny-ts via local Ollama (qwen3.5:9b) returns ranked code matches (e.g., `retry.ts#retry.ts`). The orchestrator integration crashes natively (`libc++ mutex lock failed`) when invoked from `bench run-all`; root cause is concurrent `ingest_data` task starts visible in cognee's logs. Standalone adapter usage is reliable; batch integration requires further work.
- LLM config: local Ollama at `http://localhost:11434/v1`; default model `openai/qwen3.5:9b`. `LLM_PROVIDER=openai` + custom `LLM_ENDPOINT` triggers litellm's OpenAI-compat path. `LLM_API_KEY` set to placeholder `'ollama'` (Ollama does not validate it).
- Best ingest API: `cognee.add(file_paths)` (accepts list of absolute file paths or text strings) + `cognee.cognify(datasets=["name"])` (builds knowledge graph via LLM extraction per chunk)
- Best query API: `cognee.search(query, query_type=SearchType.CHUNKS, top_k=N)` — returns `List[SearchResult]` where `search_result` is a `DocumentChunk` with `.text`, `.is_part_of` (Document with `.raw_data_location`)
- Storage config: `get_base_config()` from `cognee.base_config`; set `data_root_directory` and `system_root_directory` to isolate benchmark runs
- Starlette compat: cognee 1.0.3 references `starlette.status.HTTP_422_UNPROCESSABLE_CONTENT` but starlette 0.46.x has `HTTP_422_UNPROCESSABLE_ENTITY`. Monkey-patch required before import: `starlette.status.HTTP_422_UNPROCESSABLE_CONTENT = starlette.status.HTTP_422_UNPROCESSABLE_ENTITY`
- Quirks:
  - MCP server is not pip-installable; requires repo clone + `uv sync`
  - LLM is used during ingest (graph construction), not just at query time — ingest cost and latency is higher than vector-only systems
  - Python 3.10–3.13 required
  - Optional cloud sync; benchmark should use local-only mode (`COGNEE_SERVICE_URL` unset)
  - v1 API (`add`/`cognify`/`search`) is used; v2 (`remember`/`recall`) may work similarly but not tested here

## Cost note

- Cognee's `cognify()` makes approximately 1 LLM call per chunk (TextChunker default ~512 tokens per chunk)
- **Free (local inference)** — no API key, no network spend
- For tiny-ts (3 files, ~80 lines total): expected **10–30 min** on M-series Mac with qwen3.5:9b
- For zod (~8K files): expected **hours** per full benchmark run — use qwen3.5:4b for faster iteration
- Alternative models if qwen3.5:9b has tool-calling issues: `gemma4:26b` (17 GB, confirmed tools support) or `qwen3.5:35b-a3b-coding-nvfp4` (21 GB, max capability)

---

## 3. mempalace

- Repo: https://github.com/MemPalace/mempalace
- License: **MIT**
- MCP server: **yes** — `mempalace-mcp` console script (entry point `mempalace.mcp_server:main`); 29 MCP tools
- Setup: `pip install mempalace` (v3.3.3, 2026-04-24; Python 3.9+)
- API keys: **none** — fully local; chromadb + ONNX sentence-transformers embedded; optional hardware acceleration extras (`[gpu]`, `[coreml]`, `[dml]`)
- Local runnable: **YES**
- Plan 3 status: **READY**
- Best ingest API:
  - `mempalace mine <project-dir>` — index source files
  - `mempalace mine <transcript-dir> --mode convos` — index conversation logs
  - `mempalace sweep <transcript-dir>` — per-message storage
- Best query API:
  - `mempalace search "<query>"` — CLI semantic search
  - MCP tools: palace reads/writes, knowledge-graph operations, cross-wing navigation, drawer management, agent diaries
- Quirks:
  - Active development on `develop` branch (pushed 2026-04-27); `main` may lag — benchmark should pin a specific version
  - No LLM required for core retrieval path; raw benchmark score 96.6% without any API key
  - Optional LLM reranking available but not required
  - Stores verbatim text, not summaries/paraphrases — different retrieval character than graph-building systems
  - Dependencies: chromadb >=1.5.4, pyyaml; no heavy ML framework required at install time (ONNX model downloaded on first run)

---

## 4. hindsight

- Repo: https://github.com/vectorize-io/hindsight
- License: **MIT**
- MCP server: **not found** — no MCP server mentioned in README or docs; exposes REST API only
- Setup:
  ```bash
  docker run --rm -it --pull always -p 8888:8888 -p 9999:9999 \
    -e HINDSIGHT_API_LLM_API_KEY=$OPENAI_API_KEY \
    ghcr.io/vectorize-io/hindsight:latest
  ```
  Also has an embedded Python option (`pip install hindsight` — no separate server required)
- API keys: **LLM provider key required** (OpenAI, Anthropic, Gemini, Groq, Ollama, LMStudio, Minimax)
- Local runnable: **YES-WITH-KEY** (Ollama/LMStudio path is key-free if local model available)
- Plan 3 status: **READY-WITH-KEY**
- Best ingest API: `POST /retain` — store memories with optional context and timestamps
- Best query API: `POST /recall` — four parallel retrieval strategies (semantic, keyword, graph, temporal); `POST /reflect` — deeper analysis generating new insights from existing memories
- Quirks:
  - No MCP server — must be called via REST; CGBench adapter must wrap HTTP calls
  - "Biomimetic data structures": world facts, experiences, mental models — three memory tiers
  - Requires PostgreSQL (included in Docker image or supply external)
  - Cloud offering at https://ui.hindsight.vectorize.io/signup — benchmark uses self-hosted Docker only
  - Ollama with a local model (e.g. `llama3.2`) would make this key-free in practice

---

## 5. Mastra observational memory

- Repo: https://github.com/mastra-ai/mastra
- Docs: https://mastra.ai/docs/memory/observational-memory
- License: **NOASSERTION** (GitHub API returned `NOASSERTION`; root LICENSE file exists but is a non-standard SPDX identifier — verify manually before redistribution)
- MCP server: **no** — `@mastra/memory` is an npm library, not an MCP server; must be embedded in a Mastra agent
- Setup: `npm install @mastra/memory` (v1.17.1, Apache-2.0 per package.json)
- API keys: **LLM provider key required** — observational memory uses an LLM (Observer + Reflector agents) to distill conversation; default model is `google/gemini-2.5-flash`
- Local runnable: **YES-WITH-KEY** (LLM key required for observation pipeline)
- Plan 3 status: **READY-WITH-KEY**
- Best ingest API: Automatic — feed conversation turns to a Mastra agent; Observer fires when message token threshold is reached (default 30,000 tokens)
- Best query API: `recall` tool (retrieval mode) — semantic search over observations + raw message browsing by observation group
- Quirks:
  - **Not standalone**: requires a full Mastra agent wrapping — CGBench adapter is more complex than other systems
  - Retrieval mode is marked **experimental**; potential task-continuity issues across simultaneous threads
  - System prompt tuning may be needed when enabling resource scope
  - LLM used at ingest (observation extraction), not just query — higher latency and cost per ingest cycle
  - Package.json says Apache-2.0 but GitHub root license API says NOASSERTION — investigate before redistribution
  - Large context window recommended (128K+) for Observer/Reflector LLM calls

---

## 6. supermemory

- Repo: https://github.com/supermemoryai/supermemory
- License: **MIT** (GitHub API confirmed)
- MCP server: **yes** — hosted at `https://mcp.supermemory.ai/mcp`; install via `npx -y install-mcp@latest https://mcp.supermemory.ai/mcp --client claude --oauth=yes`
- Setup:
  ```bash
  # MCP (hosted)
  npx -y install-mcp@latest https://mcp.supermemory.ai/mcp --client claude --oauth=yes
  # SDK
  npm install supermemory   # or: pip install supermemory
  ```
- API keys: **optional** — OAuth (no key needed) or Bearer token (`sm_...`); free consumer app at https://app.supermemory.ai
- Local runnable: **YES** (MCP server is cloud-hosted; calls go to supermemory.ai — not fully local)
- Plan 3 status: **READY-WITH-KEY** (OAuth flow or free API key; the MCP endpoint is cloud-hosted, not self-hostable from the public repo)
- Best ingest API: `client.add(content)` — store content; `client.documents.uploadFile()` — multimodal
- Best query API: `client.search.memories(query)` — hybrid RAG + memory; `client.search.documents(query)` — document retrieval; `client.profile()` — user profile + optional search
- Quirks:
  - MCP server is **cloud-only** — all data transits supermemory.ai; no self-hosted option found in public repo
  - Claims #1 on LongMemEval (81.6%), LoCoMo, and ConvoMem benchmarks — compare directly against those numbers
  - Provides MemoryBench, their own open benchmarking framework
  - Rate limits and data privacy depend on supermemory.ai service terms — cloud dependency is a benchmarking concern
  - OAuth flow requires interactive browser login; API key path is simpler for automated benchmarks

---

## 7. Augment Code

- Website: https://www.augmentcode.com/
- Docs: https://docs.augmentcode.com/context-services/mcp/overview
- License: **proprietary** — commercial product; no open-source repository for the core context engine
- MCP server: **yes** — Context Engine MCP; two modes: Local (Auggie CLI) and Remote (hosted HTTP); exposes `codebase-retrieval` tool
- Setup: Sign up at augmentcode.com, then fetch config from https://app.augmentcode.com/mcp/configuration; uses OAuth (interactive) or API key (non-interactive)
- API keys: **required** — Augment account mandatory; OAuth or API key from the Augment dashboard
- Local runnable: **NO** — context engine runs on Augment's infrastructure even in "local" mode (Auggie CLI sends data to Augment servers for indexing); Remote mode is fully cloud
- Plan 3 status: **BLOCKED**
- Best ingest API: Local mode — Auggie CLI indexes working directory automatically; Remote mode — GitHub App integration for cross-repo context
- Best query API: `codebase-retrieval` MCP tool — semantic search over indexed codebase
- Quirks:
  - **No free tier**: minimum $20/month (Indie plan, 40,000 credits); average query costs 40–70 credits; 40,000 credits supports ~570–1,000 benchmark queries per month
  - **Cost-control risk**: benchmark automation could exhaust credits quickly at $20–200/month tiers
  - Credit-based pricing makes cost-per-query unpredictable at scale
  - February 2026 launch of Context Engine MCP included 1,000 free requests as a promotional offer — may no longer be available
  - Proprietary: cannot inspect retrieval internals, cannot verify indexing behavior, results are a black box
  - **Benchmark last**: run after all READY/READY-WITH-KEY systems to minimize credit spend; get explicit user approval on credit budget before running

---

## Plan 3 implementation order (revised based on discovery)

1. **mempalace** — fully local, no keys, pip install, 29 MCP tools
2. **mcp-codebase-index** — fully local, no keys, pip install, 18 MCP tools
3. **supermemory** — needs OAuth/API key; MCP hosted; simplest auth path
4. **hindsight** — needs LLM key; Docker setup; REST-only (needs adapter wrapper)
5. **Cognee** — needs LLM key; source-clone MCP; graph construction during ingest
6. **Mastra observational memory** — needs LLM key; most complex adapter (not standalone); experimental retrieval
7. **Augment Code** — BLOCKED; run last if/when user approves credit budget

---

## API keys we may need

| Key | Required by | Notes |
|-----|-------------|-------|
| LLM_API_KEY (OpenAI or compatible) | Hindsight, Mastra | Cognee now uses local Ollama (no key); Mastra requires LLM at ingest time; Hindsight allows Ollama (key-free) |
| SUPERMEMORY_API_KEY (or OAuth) | supermemory | Free tier available; OAuth is key-free but interactive |
| AUGMENT_API_KEY | Augment Code | Requires paid plan ($20/month minimum); explicit user approval needed before using |

---

## Aggregate readiness

| Status | Count | Systems |
|--------|-------|---------|
| READY | 3 of 7 | mempalace, mcp-codebase-index, Cognee (local Ollama, no key required) |
| READY-WITH-KEY | 3 of 7 | hindsight, Mastra, supermemory |
| BLOCKED | 1 of 7 | Augment Code |
| DEFERRED | 0 of 7 | — |
