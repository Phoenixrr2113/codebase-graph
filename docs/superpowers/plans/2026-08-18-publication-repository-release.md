# Publication Repository and Release Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make GitHub the trustworthy public entry point and automate verified npm releases after one authenticated bootstrap publish.

**Architecture:** CI calls the root repository and release contracts, a cross-platform matrix tests the exact tarball, GitHub community files explain contribution and security paths, and release tags publish through npm OIDC. Repository protections are enabled only after the corresponding checks succeed.

**Tech Stack:** GitHub Actions, CodeQL, Dependabot, npm trusted publishing, shields.io badges, GitHub REST API

**Spec:** `docs/superpowers/specs/2026-08-18-publication-ready-baseline-design.md`

## Global Constraints

- Workflows use least privilege and GitHub-hosted runners.
- Third-party actions are pinned to full commit SHAs.
- Job names required by branch protection are unique across workflows.
- No npm token is stored after trusted publishing is configured.
- The first publish is the only manual registry bootstrap.
- npm badges are not added until the package URL resolves.

---

### Task 1: Add public contribution and security surfaces

**Files:**
- Create: `CONTRIBUTING.md`
- Create: `SECURITY.md`
- Create: `CODE_OF_CONDUCT.md`
- Create: `.github/ISSUE_TEMPLATE/bug.yml`
- Create: `.github/ISSUE_TEMPLATE/feature.yml`
- Create: `.github/ISSUE_TEMPLATE/config.yml`
- Create: `.github/pull_request_template.md`

**Interfaces:**
- Consumes: root pnpm commands and canonical GitHub URLs
- Produces: GitHub community-profile documents and issue forms

- [ ] **Step 1: Write the contribution path**

Document Node 22, pnpm from `packageManager`, fork/branch workflow, frozen
install, `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm build`, and
`pnpm release:check` for distribution changes. State that generated `dist`
trees, secrets, and local `.codegraph` data must not be committed.

- [ ] **Step 2: Write the security policy**

Support the current minor release line, direct reporters to GitHub private
vulnerability reporting, state a 72-hour initial response target, and prohibit
public issues containing exploit details or credentials. Link only to the
canonical repository security advisory page.

- [ ] **Step 3: Add the code of conduct**

Use Contributor Covenant 2.1 with the maintainer contact routed through the
repository's private reporting or maintainer profile, not an invented support
email.

- [ ] **Step 4: Add structured issue and PR forms**

Bug form required fields: version/commit, Node version, platform, install
method, reproduction, expected behavior, actual behavior, and redacted logs.
Feature form required fields: problem, proposed outcome, alternatives, and
scope. Disable blank issues. PR template includes linked issue, change summary,
security impact, test evidence, and checklist for docs and release impact.

- [ ] **Step 5: Validate form YAML and links**

Run a Node script using the repository's YAML parser dependency or Ruby's
standard YAML parser to parse every issue form. Run `git diff --check` and use
`curl --fail --location --head` on every canonical external link.

### Task 2: Replace partial CI with the baseline gates

**Files:**
- Rewrite: `.github/workflows/ci.yml`
- Create: `.github/workflows/codeql.yml`
- Create: `.github/dependabot.yml`

**Interfaces:**
- Consumes: `pnpm audit:prod`, lint, typecheck, test, build, and release scripts
- Produces: `CI / Repository`, `CI / Package (ubuntu-latest)`, `CI / Package (macos-latest)`, `CI / Package (windows-latest)`, and `CodeQL / Analyze` checks

- [ ] **Step 1: Pin current official actions**

Resolve the full commit SHAs for the current major releases of
`actions/checkout`, `actions/setup-node`, `pnpm/action-setup`,
`github/codeql-action/init`, and `github/codeql-action/analyze` from their
official repositories. Keep a version comment beside each SHA.

- [ ] **Step 2: Create the repository job**

On pushes and pull requests to `main`, use Node 22 and a frozen pnpm install,
then run:

```bash
pnpm audit:prod
pnpm lint
pnpm typecheck
pnpm test
pnpm build
pnpm build:mcpb
```

Set `CODEGRAPH_EMBEDDING_PROVIDER=none`. Remove the existing exclusions and all
`continue-on-error` behavior.

- [ ] **Step 3: Create the package matrix**

Build the tarball once on Ubuntu and upload it as an artifact. Matrix jobs on
Ubuntu, macOS, and Windows download that exact tarball and run the consumer
smoke script without rebuilding it. Artifact names and paths must not contain
shell-expanded globs.

- [ ] **Step 4: Add CodeQL**

Use JavaScript/TypeScript analysis on pull requests, pushes to `main`, and a
weekly schedule. Grant only `security-events: write`, `packages: read`, and
`contents: read` as required by the official action.

- [ ] **Step 5: Add Dependabot**

Configure weekly updates for the pnpm workspace root and GitHub Actions.
Group patch/minor pnpm updates separately from majors. Limit open pull requests
to five per ecosystem and label them `dependencies`.

- [ ] **Step 6: Validate workflow syntax locally**

Parse all workflow and Dependabot YAML files, run actionlint if available, and
verify every `uses:` value is a 40-character SHA with a human-readable version
comment.

### Task 3: Add tag-driven trusted publication

**Files:**
- Create: `.github/workflows/release.yml`
- Create: `scripts/release/verify-release-tag.mjs`
- Create: `scripts/release/__tests__/verify-release-tag.test.ts`
- Modify: `package.json`

**Interfaces:**
- Consumes: annotated `vX.Y.Z` tag and source npm manifest
- Produces: npm publication with provenance and matching GitHub release

- [ ] **Step 1: Test tag/version validation**

Export:

```js
export function verifyReleaseTag(tag, packageName, packageVersion)
```

Accept only `refs/tags/v${packageVersion}` for package `codegraph-mcp`. Reject a
missing `v`, prerelease mismatch, wrong package name, or non-semver version with
an actionable error.

- [ ] **Step 2: Implement the release preflight**

The CLI reads `GITHUB_REF` and `packages/npm-package/package.json`, validates
the tag, then runs `npm view codegraph-mcp@<version> version --json`. Exit 1 if
the version already exists. Treat npm E404 as the expected unpublished state.

- [ ] **Step 3: Create the release workflow**

Trigger on `v*` tags. Configure:

```yaml
permissions:
  contents: write
  id-token: write
concurrency:
  group: npm-release
  cancel-in-progress: false
```

Use a protected `npm` environment. Check out the exact tag, use Node 22.14 or
newer and npm 11.5.1 or newer, disable release caching, install with frozen
pnpm, run the tag preflight, full repository gate, and `pnpm release:check`.
Publish from the generated staging directory with `npm publish --access public`.
Trusted publishing supplies OIDC authentication and automatic provenance.

- [ ] **Step 4: Verify the registry artifact before creating the release**

Poll `npm view codegraph-mcp@<version> version --json` with a bounded retry of
six attempts and ten seconds between attempts. Install
`codegraph-mcp@<version>` into a fresh temporary consumer and run the same CLI
and MCP smoke checks. Only then create the GitHub release and attach the local
tarball plus its SHA-256 checksum.

- [ ] **Step 5: Add the versioning operator command to documentation**

The release procedure is:

```bash
cd packages/npm-package
npm version patch
git push origin HEAD
git push origin vX.Y.Z
```

The operator replaces `X.Y.Z` with the version printed by `npm version`; the
workflow itself rejects any mismatch. Do not hand-edit a release version.

### Task 4: Rewrite the README around verified access paths

**Files:**
- Modify: `README.md`
- Rewrite: `docs/DISTRIBUTION-SETUP.md`
- Modify: `docs/distribution/launch-checklist.md`
- Modify: `docs/commercial-distribution-strategy.md`

**Interfaces:**
- Consumes: verified local commands, GitHub URL, Vercel URL, and npm package URL
- Produces: accurate developer entry points and release operator guide

- [ ] **Step 1: Add real pre-publication badges**

Add badges for CI, CodeQL, GitHub stars, and MIT license. Each badge links to
its corresponding GitHub workflow, stargazers page, or license file.

- [ ] **Step 2: Add the developer access section**

Link clearly to:

- Live application: `https://v0-landing-page-build-kappa-virid.vercel.app`
- Source: `https://github.com/Phoenixrr2113/codebase-graph`
- Issues: `https://github.com/Phoenixrr2113/codebase-graph/issues`
- Discussions: `https://github.com/Phoenixrr2113/codebase-graph/discussions`
- Contribution guide, security policy, and MIT license
- npm: `https://www.npmjs.com/package/codegraph-mcp` after bootstrap

- [ ] **Step 3: Replace stale install and configuration copy**

Use `npx codegraph-mcp` and the installed `codegraph-mcp` bin. Remove
`@codegraph/mcp`, `randywilson/codegraph`, `codegraph.dev`, Polar, commercial
license keys, and closed-binary language from active instructions.

- [ ] **Step 4: Make old commercial planning explicitly historical**

Add a top-level superseded notice to the commercial strategy that links to the
publication baseline spec and states it is retained only as decision history.
Rewrite distribution setup for npm bootstrap, trusted publisher configuration,
tagging, registry smoke verification, and recovery. Update the launch checklist
to use npm downloads as the post-publication usage metric.

- [ ] **Step 5: Verify every active URL and command**

Run link checks for active README and setup URLs. Run every documented local
command exactly as written. Searches for stale identifiers must return only the
clearly marked historical document:

```bash
rg -n '@codegraph/mcp|randywilson/codegraph|codegraph\.dev|polar\.sh|CODEGRAPH_LICENSE' README.md docs packages/npm-package packages/mcpb
```

### Task 5: Bootstrap npm and enable repository settings

**Files:**
- No repository files after prior tasks
- Modify external state: npm package settings and GitHub repository settings

**Interfaces:**
- Consumes: passing local release gate and merged GitHub CI
- Produces: first npm version, trusted publisher, protected `main`, Discussions, and security settings

- [ ] **Step 1: Push the branch and verify GitHub checks**

Push `cleanup/publication-ready-baseline`, open a pull request, and wait for
every CI and CodeQL job. Fix failures on the branch. Do not enable required
checks until the exact job names have completed successfully once.

- [ ] **Step 2: Perform the one-time authenticated bootstrap publish**

Verify `npm whoami` and package availability without printing token data. From
a clean checkout of the reviewed commit, run the full release gate, then:

```bash
cd packages/npm-package/dist
npm publish --access public --provenance
```

Immediately verify `npm view codegraph-mcp@0.1.0`, install the registry package
in a fresh temporary project, run `codegraph-mcp --version`, and complete the
MCP smoke test. If npm authentication is absent, stop at this exact command and
request login rather than creating or exposing a token.

- [ ] **Step 3: Configure npm trusted publishing**

In package settings, authorize GitHub user `Phoenixrr2113`, repository
`codebase-graph`, workflow filename `release.yml`, environment `npm`, and action
`npm publish`. Then set publishing access to require 2FA and disallow tokens.

- [ ] **Step 4: Add npm badges after the package resolves**

Add linked npm version and npm weekly-download badges to README and verify both
badge image endpoints return HTTP 200.

- [ ] **Step 5: Enable GitHub collaboration and security settings**

Enable Discussions, automatic head-branch deletion, vulnerability alerts,
automated security fixes, private vulnerability reporting, and secret push
protection where the account supports them.

Protect `main` with strict required checks for the exact CI repository, three
package matrix, and CodeQL job names. Require pull requests and conversation
resolution with zero required approving reviews. Block force pushes and branch
deletion. Apply the rule to administrators only after confirming the solo
maintainer can merge a green pull request without self-approval.

- [ ] **Step 6: Verify external state through APIs**

Use GitHub APIs to verify Discussions, delete-on-merge, security features,
workflow runs, and branch protection. Use npm registry metadata to verify name,
version, license, repository, bin, provenance, and download endpoint.

### Task 6: Fresh-clone completion audit and commit

**Files:**
- Create: `docs/releases/0.1.0-verification.md`
- Modify: `README.md` for npm badges from Task 5

**Interfaces:**
- Consumes: merged commit, registry package, GitHub settings, and release workflow
- Produces: requirement-by-requirement publication evidence

- [ ] **Step 1: Verify from a fresh temporary clone**

Clone the GitHub branch into a directory created by `mktemp -d`. Run frozen
install, audit, lint, typecheck, tests, build, MCPB build, and release check.
Record command, UTC timestamp, commit SHA, exit code, test count, tarball sizes,
and package smoke results. Do not record machine secrets or environment values.

- [ ] **Step 2: Verify the registry artifact separately**

Install `codegraph-mcp@0.1.0` from npm in a second empty temporary consumer,
verify version and MCP handshake, and record the npm integrity and provenance
URLs.

- [ ] **Step 3: Verify GitHub state**

Record zero open secret alerts, successful CI and CodeQL, enabled Dependabot,
branch protection contexts, Discussions, community profile health, and the
GitHub release asset checksums.

- [ ] **Step 4: Commit the evidence**

```bash
git add README.md docs/releases/0.1.0-verification.md
git commit -m "docs: record publication verification"
```

Expected: the verification document maps all 14 acceptance criteria in the
design spec to current evidence.
