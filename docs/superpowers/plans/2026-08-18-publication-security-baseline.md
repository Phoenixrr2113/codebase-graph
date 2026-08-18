# Publication Security Baseline Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove unexplained secret alerts and all critical or high production dependency advisories without broad modernization.

**Architecture:** Remediate direct dependencies first, use documented pnpm overrides only for residual transitive advisories, then resolve the historical test-fixture alert through GitHub. The lockfile and audit output are the authoritative dependency evidence.

**Tech Stack:** pnpm 9, npm advisory database, GitHub secret scanning API, Vitest

**Spec:** `docs/superpowers/specs/2026-08-18-publication-ready-baseline-design.md`

## Global Constraints

- Production audit ends with zero critical and high advisories.
- Do not introduce a major dependency upgrade unless no compatible security patch exists.
- Never print the matched secret-scanning value.
- Do not rewrite Git history for the historical synthetic fixture.
- Keep the current package names and workspace boundaries during this plan.

---

### Task 1: Establish the reproducible security failure

**Files:**
- Modify: `package.json`
- Generated: `pnpm-lock.yaml`

**Interfaces:**
- Consumes: pnpm audit JSON from the current lockfile
- Produces: root command `pnpm audit:prod`

- [ ] **Step 1: Add the production audit contract**

Add this script to the root `package.json`:

```json
"audit:prod": "pnpm audit --prod --audit-level high"
```

- [ ] **Step 2: Run the audit and verify the baseline fails**

Run: `pnpm audit:prod`

Expected: non-zero exit with at least one critical or high advisory, including
the current `tar`, `next`, or `sharp` paths.

- [ ] **Step 3: Capture the unique vulnerable modules**

Run:

```bash
pnpm audit --prod --json | jq -r '.advisories[] | select(.severity == "critical" or .severity == "high") | [.module_name, .severity, .patched_versions] | @tsv' | sort -u
```

Expected: a finite module list that can be mapped to a direct parent or a
targeted override. Do not copy advisory fixture values or environment data.

### Task 2: Upgrade compatible direct parents

**Files:**
- Modify: `apps/web/package.json`
- Modify: `packages/mcp-server/package.json`
- Modify: `benchmarks/cgbench-v1/package.json`
- Modify: `pnpm-lock.yaml`

**Interfaces:**
- Consumes: the vulnerable dependency paths from Task 1
- Produces: patched Next.js and MCP dependency trees

- [ ] **Step 1: Upgrade the landing application within current majors**

Run:

```bash
pnpm --filter codegraph-landing up next@16.3.1 react@19.2.8 react-dom@19.2.8 postcss@8.5.18
```

Expected: manifest and lockfile use the stated versions without changing React
or Next major versions.

- [ ] **Step 2: Upgrade the MCP SDK in both consumers**

Run:

```bash
pnpm --filter @codegraph/mcp-server up @modelcontextprotocol/sdk@1.30.0
pnpm --filter @codegraph/cgbench-v1 up @modelcontextprotocol/sdk@1.30.0
```

Expected: both manifests resolve MCP SDK 1.30.0 and the lockfile refreshes its
Hono, AJV, URL, and IP dependency paths where supported upstream.

- [ ] **Step 3: Verify the direct upgrades compile before adding overrides**

Run:

```bash
pnpm --filter codegraph-landing exec tsc --noEmit -p tsconfig.json
pnpm --filter @codegraph/mcp-server build
pnpm --filter @codegraph/cgbench-v1 build
```

Expected: existing landing type defects may still fail and are owned by the
verification plan. The MCP server and benchmark builds must pass. Any new error
introduced by the upgrades must be fixed before continuing.

### Task 3: Patch residual transitive advisories narrowly

**Files:**
- Modify: `package.json`
- Modify: `pnpm-lock.yaml`

**Interfaces:**
- Consumes: residual audit paths after Task 2
- Produces: root `pnpm.overrides` security floor map

- [ ] **Step 1: Add patch-level security floors for residual paths**

Add the following root field, retaining only entries still required by the
post-upgrade audit:

```json
"pnpm": {
  "overrides": {
    "brace-expansion@>=2.0.0 <2.1.4": "2.1.4",
    "fast-uri@>=3.0.0 <3.1.5": "3.1.5",
    "hono@<4.12.25": "4.12.25",
    "ip-address@<=10.3.0": "10.3.1",
    "js-yaml@>=3.0.0 <3.15.1": "3.15.1",
    "nanoid@<3.3.18": "3.3.18",
    "postcss@<=8.5.17": "8.5.18",
    "sharp@<0.35.0": "0.35.0",
    "tar@<=7.5.18": "7.5.19",
    "undici@>=7.0.0 <7.29.0": "7.29.0"
  }
}
```

Do not keep an override when Task 2 already resolves every vulnerable path for
that module.

- [ ] **Step 2: Regenerate dependencies from the manifest**

Run: `pnpm install --lockfile-only`

Expected: success with no peer-dependency regression hidden in the output.

- [ ] **Step 3: Verify the security gate**

Run: `pnpm audit:prod`

Expected: exit 0 with zero critical and zero high production advisories.

- [ ] **Step 4: Verify dependency consumers**

Run:

```bash
pnpm --filter @codegraph/mcp-server build
pnpm --filter @codegraph/plugin-nlp exec vitest run
pnpm --filter codegraph-landing build
```

Expected: MCP and NLP pass. Landing may still expose the already-recorded type
errors, but it must not show a dependency-resolution or runtime-package error.

### Task 4: Resolve the historical secret-scanning alert

**Files:**
- No repository files
- Modify external state: GitHub secret-scanning alert 2

**Interfaces:**
- Consumes: redacted alert metadata for commit `f09a02ee568219f2b3693bd018b00a30669e75d6`
- Produces: resolved GitHub alert with resolution `used_in_tests`

- [ ] **Step 1: Reconfirm the alert without requesting the secret field**

Run:

```bash
gh api repos/Phoenixrr2113/codebase-graph/secret-scanning/alerts/2 --jq '{number,state,secret_type,resolution,created_at}'
```

Expected: alert 2 is open and its type is `stripe_webhook_signing_secret`.

- [ ] **Step 2: Reconfirm the current tree does not contain the old fixture**

Run:

```bash
git ls-tree -r --name-only HEAD | rg 'packages/parser|payment\.test\.ts'
```

Expected: no output.

- [ ] **Step 3: Resolve the alert as historical test data**

Run:

```bash
gh api --method PATCH repos/Phoenixrr2113/codebase-graph/secret-scanning/alerts/2 -f state=resolved -f resolution=used_in_tests -f resolution_comment='Synthetic Stripe-shaped parser fixture in a historical test file; the file is absent from the current tree.'
```

Expected: response state `resolved`, without displaying the secret field.

- [ ] **Step 4: Verify no unexplained alert remains**

Run:

```bash
gh api repos/Phoenixrr2113/codebase-graph/secret-scanning/alerts --paginate --jq '[.[] | select(.state == "open") | {number,secret_type,created_at}]'
```

Expected: `[]`.

### Task 5: Commit the security slice

**Files:**
- Modify: files changed by Tasks 1 through 3

**Interfaces:**
- Consumes: passing production audit and targeted builds
- Produces: independently reviewable security baseline commit

- [ ] **Step 1: Run the final slice checks**

Run:

```bash
pnpm install --frozen-lockfile
pnpm audit:prod
git diff --check
```

Expected: every command exits 0.

- [ ] **Step 2: Commit**

```bash
git add package.json pnpm-lock.yaml apps/web/package.json packages/mcp-server/package.json benchmarks/cgbench-v1/package.json
git commit -m "fix: establish production security baseline"
```
