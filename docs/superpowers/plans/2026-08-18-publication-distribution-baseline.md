# Publication Distribution Baseline Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Produce a deterministic MIT npm tarball that installs the correct native dependencies on each consumer platform and passes an MCP runtime smoke test.

**Architecture:** Bundle internal workspace modules from the built MCP entry point, externalize platform-sensitive public dependencies, generate a clean staging tree from one source manifest, and validate the packed artifact in a temporary consumer. MCPB remains a separate platform-local build.

**Tech Stack:** Node 22, esbuild 0.27, npm pack, MCP SDK 1.30, pnpm 9, Vitest 3

**Spec:** `docs/superpowers/specs/2026-08-18-publication-ready-baseline-design.md`

## Global Constraints

- Canonical npm name is `codegraph-mcp` while it remains available.
- The package and all active distribution copy use MIT licensing.
- `packages/npm-package/dist` is deleted and recreated on every build.
- The tarball contains no `node_modules`, `.node` binaries, workspace protocol references, secrets, or absolute source paths.
- Compressed tarball budget is 15 MB.
- Node 20 remains the consumer engine floor; Node 22 is the release runtime.

---

### Task 1: Make package metadata canonical and testable

**Files:**
- Modify: `packages/npm-package/package.json`
- Modify: `packages/npm-package/bin/codegraph-mcp.mjs`
- Delete: `packages/npm-package/postinstall.mjs`
- Create: `packages/npm-package/__tests__/cli.test.ts`

**Interfaces:**
- Consumes: package manifest adjacent to the installed `bin` directory
- Produces: `codegraph-mcp --version` and MIT public package metadata

- [ ] **Step 1: Write the failing CLI version test**

The test copies the bin file and a fixture package manifest into a temporary
directory, runs `node bin/codegraph-mcp.mjs --version`, and asserts stdout is
exactly `9.8.7\n` with exit code 0.

- [ ] **Step 2: Verify the test fails**

Run:

```bash
pnpm --filter @codegraph/mcp exec vitest run __tests__/cli.test.ts
```

Expected: failure because the current bin imports the server instead of
handling `--version`.

- [ ] **Step 3: Read the installed version dynamically**

At the start of the bin file, read `../package.json` relative to
`import.meta.url`, validate that `name === 'codegraph-mcp'`, and print its
string version when `process.argv` contains `--version` or `-v`. A missing or
invalid manifest writes a concise error to stderr and exits 1.

- [ ] **Step 4: Replace the source manifest**

Set these canonical fields:

```json
{
  "name": "codegraph-mcp",
  "version": "0.1.0",
  "license": "MIT",
  "homepage": "https://v0-landing-page-build-kappa-virid.vercel.app",
  "repository": {
    "type": "git",
    "url": "git+https://github.com/Phoenixrr2113/codebase-graph.git"
  },
  "bugs": {
    "url": "https://github.com/Phoenixrr2113/codebase-graph/issues"
  },
  "publishConfig": {
    "access": "public",
    "provenance": true
  },
  "engines": {
    "node": ">=20.0.0"
  }
}
```

Keep the bin mapping, remove the postinstall script, and add `esbuild` and
`vitest` as development dependencies. Remove all `codegraph.dev`, Polar, and
commercial-license fields.

- [ ] **Step 5: Delete the commercial postinstall file and verify the test**

Run the CLI test again. Expected: pass with no attempt to import the server for
`--version`.

### Task 2: Build npm directly from the MCP entry point

**Files:**
- Rewrite: `packages/npm-package/build.mjs`
- Create: `packages/npm-package/lib/package-metadata.mjs`
- Create: `packages/npm-package/__tests__/package-metadata.test.ts`
- Modify: `pnpm-lock.yaml`

**Interfaces:**
- Consumes: built `packages/mcp-server/dist/index.js` and source workspace manifests
- Produces: clean `packages/npm-package/dist` staging directory

- [ ] **Step 1: Write metadata unit tests**

Export this interface from `package-metadata.mjs`:

```js
export function createPublishedManifest({ packageManifest, dependencyManifests })
```

Tests assert that the result:

- Preserves canonical name, version, description, license, URLs, bin, engines,
  keywords, and publishConfig.
- Has no build or postinstall scripts.
- Contains no `workspace:` versions.
- Reads dependency ranges for `@huggingface/transformers`,
  `@modelcontextprotocol/sdk`, `tree-sitter`, `tree-sitter-go`,
  `tree-sitter-python`, `tree-sitter-rust`, and `tree-sitter-typescript` from
  their owning workspace manifests.
- Places `falkordblite` in `optionalDependencies` using the graph workspace's
  development range while that optional driver is advertised.

- [ ] **Step 2: Verify the metadata tests fail**

Run: `pnpm --filter codegraph-mcp exec vitest run __tests__/package-metadata.test.ts`

Expected: failure because the module does not exist.

- [ ] **Step 3: Implement metadata generation with runtime validation**

Validate every input as an object, require all named string fields, and throw
an error naming the missing package and dependency. Return a plain JSON-safe
object. Do not use `any` in TypeScript tests; narrow imported JavaScript values
as `unknown`.

- [ ] **Step 4: Rewrite the build pipeline using esbuild's JavaScript API**

The builder must:

1. Remove `packages/npm-package/dist` recursively.
2. Verify `packages/mcp-server/dist/index.js` exists.
3. Bundle that entry to `dist/server/index.mjs` with `platform: 'node'`,
   `target: 'node20'`, `format: 'esm'`, and sourcemaps disabled.
4. Mark only the published native/runtime dependencies from Task 2 external.
5. Copy the bin file and root `LICENSE`.
6. Generate `dist/package.json` through `createPublishedManifest`.
7. Generate an MIT README with verified GitHub, installation, configuration,
   and environment-variable links.
8. Set the bin file mode to `0o755`.

The build must not read or copy `packages/mcpb/dist`.

- [ ] **Step 5: Verify deterministic clean staging**

Create `dist/sentinel.txt`, rerun the builder, and verify the sentinel is gone.
Run the builder twice and compare SHA-256 hashes for `server/index.mjs`,
`package.json`, `LICENSE`, and `README.md`. Expected: hashes match.

### Task 3: Validate the staged and packed package

**Files:**
- Create: `scripts/release/validate-package.mjs`
- Create: `scripts/release/__tests__/validate-package.test.ts`
- Modify: `package.json`

**Interfaces:**
- Consumes: a staging directory path and npm pack JSON
- Produces: exit 0 only for a policy-compliant artifact

- [ ] **Step 1: Write rejection tests**

Export:

```js
export async function validatePackageDirectory(directoryUrl)
export function validatePackReport(report)
```

Tests build temporary directories and assert rejection for each of these:

- A manifest with `workspace:*`.
- A `node_modules` directory.
- A `.node` file.
- A source map containing the repository's absolute path.
- Missing or non-executable bin file.
- Non-MIT license or incorrect repository URL.
- Pack report `size` greater than `15 * 1024 * 1024`.

A valid fixture passes and returns its name, version, file count, packed size,
and unpacked size.

- [ ] **Step 2: Run tests and verify they fail before implementation**

Run: `pnpm exec vitest run scripts/release/__tests__/validate-package.test.ts`

- [ ] **Step 3: Implement recursive validation**

Use `node:fs/promises`, `node:path`, and explicit guards. Never follow symlinks
outside the staging directory. Report every violation in one thrown error so a
release run gives a complete correction list.

- [ ] **Step 4: Add the non-publishing pack command**

Add root scripts:

```json
"build:npm": "pnpm turbo run build --filter=!codegraph-mcp && node packages/npm-package/build.mjs",
"pack:npm": "npm pack --dry-run --json --prefix packages/npm-package/dist",
"validate:npm": "node scripts/release/validate-package.mjs packages/npm-package/dist"
```

The validator CLI must run directory validation, execute a real non-dry npm
pack into a temporary output directory, parse npm's JSON report, validate size
and contents, print the tarball path, and never publish.

### Task 4: Smoke-test a real consumer installation and MCP handshake

**Files:**
- Create: `scripts/release/smoke-package.mjs`
- Create: `scripts/release/__tests__/smoke-package.test.ts`
- Modify: `package.json`

**Interfaces:**
- Consumes: tarball path printed by the validator
- Produces: verified CLI version and MCP initialize/list-tools/shutdown exchange

- [ ] **Step 1: Write the process-contract tests**

Unit-test that the smoke runner rejects a missing tarball, a version mismatch,
a non-zero npm install, and an MCP child that writes non-JSON data to stdout.
Inject the command runner into the exported function rather than mocking global
process functions. Define the JavaScript contract with JSDoc:

```js
/**
 * @typedef {{
 *   run(command: string, args: string[], options: import('node:child_process').SpawnSyncOptionsWithStringEncoding): import('node:child_process').SpawnSyncReturns<string>
 * }} CommandRunner
 */
```

- [ ] **Step 2: Implement the temporary consumer flow**

The script creates a directory with `mkdtemp`, writes a minimal package.json,
runs `npm install <absolute-tarball> --ignore-scripts`, then verifies
`node_modules/.bin/codegraph-mcp --version` equals the tarball version.

Use `@modelcontextprotocol/sdk/client/index.js` and
`@modelcontextprotocol/sdk/client/stdio.js` from the consumer installation to
start the installed bin with:

```text
CODEGRAPH_EMBEDDING_PROVIDER=none
CODEGRAPH_LOG_STDERR=true
```

Connect a client, call `listTools`, require the expected `search`, `knowledge`,
`codebase`, and `query` tools, close the client, and verify the child exits.
Always remove the temporary directory in `finally`.

- [ ] **Step 3: Add the release check aggregator**

Add:

```json
"smoke:npm": "node scripts/release/smoke-package.mjs",
"release:check": "pnpm build:npm && pnpm validate:npm && pnpm smoke:npm"
```

Pass the generated tarball path through a small JSON result file inside an
ignored temporary directory, not through command substitution.

- [ ] **Step 4: Run the full local release gate**

Run: `pnpm release:check`

Expected: clean build, policy validation, tarball below 15 MB, successful
temporary install, correct `0.1.0` version, and successful MCP tool listing.

### Task 5: Make MCPB portable but independent

**Files:**
- Create: `packages/mcpb/package.json`
- Modify: `packages/mcpb/build.mjs`
- Modify: `packages/mcpb/manifest.json`
- Modify: `packages/mcpb/README.md`
- Modify: `pnpm-lock.yaml`

**Interfaces:**
- Consumes: built MCP server and local platform dependencies
- Produces: clean platform-local MCPB staging directory

- [ ] **Step 1: Add MCPB's declared build dependency**

Create a private workspace manifest with `esbuild: ^0.27.7` as a development
dependency and `build: node build.mjs`.

- [ ] **Step 2: Replace the hardcoded esbuild binary invocation**

Import `build` from `esbuild` and pass the existing bundle options through its
JavaScript API. Pass the external package array directly. Remove the shell-built
command string and the hardcoded Darwin path.

- [ ] **Step 3: Generate truthful platform metadata**

When copying the manifest into `dist`, set its version from the npm source
manifest, set repository/homepage to canonical URLs, remove commercial API-key
requirements that are optional in offline mode, and set compatibility platforms
to `[process.platform]`.

- [ ] **Step 4: Verify from clean output**

Run:

```bash
pnpm install --frozen-lockfile
pnpm build:mcpb
```

Expected: build succeeds without a hardcoded esbuild path, removes an injected
sentinel from its output, and reports only the current platform in the generated
manifest.

### Task 6: Commit the distribution slice

**Files:**
- Modify: all files from Tasks 1 through 5

**Interfaces:**
- Consumes: passing package and MCPB gates
- Produces: independently reviewable distribution baseline commit

- [ ] **Step 1: Run final distribution verification**

Run:

```bash
pnpm exec vitest run packages/npm-package/__tests__ scripts/release/__tests__
pnpm release:check
pnpm build:mcpb
git diff --check
```

Expected: every command exits 0.

- [ ] **Step 2: Commit**

```bash
git add package.json pnpm-lock.yaml packages/npm-package packages/mcpb scripts/release
git commit -m "feat: build portable npm distribution"
```
