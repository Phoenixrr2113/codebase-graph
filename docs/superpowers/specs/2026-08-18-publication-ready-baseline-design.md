# Publication-Ready Baseline Design

**Date:** 2026-08-18  
**Status:** Approved  
**Repository:** `Phoenixrr2113/codebase-graph`

## Purpose

Establish a trustworthy public baseline for CodeGraph before its first npm
release. The repository must be secure, reproducible, understandable to a new
developer, and able to publish from GitHub without a long-lived registry token.

The baseline covers four sequential slices:

1. Security and dependency health.
2. Truthful local and CI verification.
3. Deterministic, cross-platform npm distribution.
4. Public repository hygiene, documentation, and release automation.

Each slice must leave the branch in a reviewable state. Major dependency
upgrades and unrelated refactors are out of scope unless they are the smallest
safe route to a required security patch.

## Current-State Problems

- Production dependency audit reports one critical and 33 high advisories.
- GitHub secret scanning has an open alert caused by a Stripe-shaped test
  fixture.
- CI omits the landing application and the npm package.
- The landing build ignores TypeScript errors, direct type-checking fails, and
  the lint script has no installed linter.
- Some package test scripts do not discover their tests.
- Three tracked `.woff2` files contain HTML instead of font data.
- The MCPB builder hardcodes a macOS esbuild binary path.
- The npm builder may reuse stale MCPB output and copies the publishing
  machine's native `node_modules` tree.
- The resulting package is roughly 57 MB compressed and 614 MB unpacked.
- Package metadata points at repositories and domains that are not canonical.
- The generated npm package uses a proprietary license and claims a required
  runtime license key even though the current server has no license gate, the
  public project is MIT, and the commercial binary plan is retired.
- The public repository lacks standard contribution and security guidance,
  automated dependency maintenance, code scanning, and branch protection.

## Decisions

### Product and license

CodeGraph is an MIT-licensed open-source project. The npm artifact will include
the repository's MIT license. The abandoned Polar licensing copy, stale runtime
license instructions, commercial postinstall output, and commercial
distribution instructions will be removed or explicitly archived as historical
material.

The canonical project locations are:

- Source, issues, and contribution: the current GitHub repository.
- Live application: the current Vercel deployment recorded in GitHub.
- Package documentation: the repository README until a real custom domain is
  registered and verified.

No unverified `codegraph.dev`, Polar, or old GitHub owner URL may appear in
active package metadata or setup instructions.

### Package identity

Use the unscoped npm name `codegraph-mcp` unless the registry reports that it
became unavailable before the bootstrap publish. The scoped name
`@codegraph/mcp` requires ownership of the `codegraph` npm scope, which is not
currently authenticated or proven. A registry conflict is a hard stop; the
workflow must not silently choose another name.

The package manifest is the single source of truth for package name and
version. Generated manifests, the CLI `--version` output, the MCPB manifest,
the Git tag, and the GitHub release must agree with it.

### Release model

The first npm release is a one-time authenticated bootstrap because npm trusted
publishers can only be configured from an existing package's settings. After
that bootstrap, GitHub Actions publishes with npm trusted publishing through
OIDC. No `NPM_TOKEN` is stored in GitHub.

Subsequent releases use an annotated `vX.Y.Z` tag that matches the package
version. A release workflow rebuilds from a clean checkout, runs the full
repository and release gates, publishes to npm, verifies the registry artifact,
and creates a GitHub release. A mismatched tag, dirty generated metadata, failed
check, or existing registry version fails before publication.

## Architecture and Data Flow

The root package scripts are the public verification interface. Developers and
GitHub Actions run the same commands.

```text
frozen install
  -> production security audit
  -> lint
  -> type-check
  -> unit and integration tests
  -> monorepo build
  -> clean npm staging build
  -> package metadata and contents validation
  -> npm pack
  -> temporary consumer install
  -> CLI version and MCP handshake smoke tests
```

The CI workflow has unique, stable job names so branch protection can require
them without ambiguity. It contains:

- A repository verification job on Linux.
- A package install and runtime smoke matrix on Linux, macOS, and Windows.
- A FalkorDB integration job that becomes blocking once its documented suite
  is deterministic.
- CodeQL analysis in a dedicated workflow.

No job may use `continue-on-error` for a baseline requirement. An intentionally
optional test must identify its prerequisite and report a skip explicitly.

## Security Baseline

### Secret scanning

The Stripe-shaped parser fixture exists only in historical commit
`f09a02ee568219f2b3693bd018b00a30669e75d6`; its source file is no longer in the
current tree. The alert will be resolved as test data after its redacted commit
location is recorded. No history rewrite is required because the detected value
was a synthetic scanner test, not a credential. The actual matched value will
never be printed in logs or documentation.

### Dependencies

Prefer upgrading a direct dependency that introduces a vulnerable transitive
package. Use a pnpm override only when the direct upstream has no compatible
release and the overridden version satisfies the parent's contract. Every
override must include a short reason and a targeted verification command.

The production baseline is zero unresolved critical and high advisories. A
moderate or low advisory may remain only when its reachable behavior and
mitigation are documented in the design's implementation record. Dependabot
will check pnpm and GitHub Actions weekly, with safe patch and minor updates
grouped separately from majors.

### GitHub hardening

After the new CI jobs pass on the branch, protect `main` with strict required
status checks, pull requests, conversation resolution, and blocked force pushes
and deletion. Do not require a second reviewer because this is currently a
single-maintainer repository. Enable dependency security updates, secret push
protection when available, private vulnerability reporting, and CodeQL default
or workflow analysis.

Workflow permissions use least privilege. Third-party actions are pinned to
full commit SHAs and maintained by Dependabot.

## Truthful Verification

### Landing application

Remove `typescript.ignoreBuildErrors`. Fix every direct TypeScript error rather
than changing types to `any`. Add a supported ESLint configuration and ensure
the lint command is installed and non-interactive. Replace the invalid font
files with valid local assets from their licensed source or switch to a
documented system/font package path that builds without network access.

### Packages and tests

Every workspace package must either run its owned tests or intentionally use
`--passWithNoTests` when it truly has no test files. Package-local Vitest
configuration must not accidentally inherit the root scripts-only include.

The PDF loader warning is treated as a real boundary defect until an explicit
PDF ingestion test proves the current `pdf-parse` API works. Integration tests
that need FalkorDB use the CI service container and deterministic environment
configuration.

### Root commands

The baseline exposes and validates these root contracts:

- `pnpm lint`
- `pnpm typecheck`
- `pnpm test`
- `pnpm build`
- `pnpm audit:prod`
- `pnpm release:check`

`release:check` performs the package build, validation, pack, temporary install,
and runtime smoke sequence. It must be safe to run repeatedly and must never
publish.

## npm Package Design

The npm package is built directly from the MCP server entry point. It no longer
copies MCPB output.

Internal `@codegraph/*` workspace modules are bundled into JavaScript. Native
or platform-sensitive dependencies are external and declared in the published
manifest so npm installs the correct build for the consumer platform. This
includes Tree-sitter and the required grammars, the MCP SDK where bundling is
unsupported, and the transformer/runtime packages required by NLP features.
FalkorDBLite remains optional and is represented as an optional dependency if
the embedded driver remains advertised.

The builder uses esbuild's JavaScript API from the declared dependency. It
deletes and recreates its staging directory every time, reads versions from
source manifests, copies the root MIT license, and generates no runtime secrets
or machine-specific paths.

The package validator rejects:

- Incorrect name, version, license, repository, bugs, homepage, or executable.
- Missing runtime files or an invalid executable mode.
- Workspace protocol references.
- Bundled `node_modules`, `.node` binaries, secrets, caches, source maps with
  absolute paths, or unrelated repository files.
- An unexpectedly large tarball. The initial compressed budget is 15 MB and
  may only be raised with measured justification.
- A CLI whose `--version` does not equal the package version.
- A server that cannot complete an MCP initialize and shutdown exchange in a
  temporary consumer project.

The cross-platform CI matrix installs the tarball with the platform's npm and
runs the version and MCP smoke checks. This validates the package users receive,
not the monorepo's linked dependency tree.

## MCPB Boundary

MCPB is a separate platform-local artifact because it includes native modules.
Its builder will use the same portable esbuild API and clean-output rules, but
the npm package will not depend on MCPB output. Active documentation will stop
claiming that one native MCPB bundle supports all operating systems unless a
platform matrix proves that claim.

An MCPB build smoke check is part of repository verification. Publishing MCPB
assets to a marketplace is not required for the first npm release.

## Repository and Developer Experience

The README will lead with the verified installation and development paths. It
will link to the live application, GitHub source, issues, discussions if
enabled, npm package, contribution guide, security policy, and license.

Badges will include CI, CodeQL, npm version, npm downloads, GitHub stars, and
MIT license. npm badges are added only when their targets resolve after the
bootstrap publication. Before publication, GitHub stars and CI provide real
usage and health signals without inventing download data.

Add:

- `CONTRIBUTING.md`
- `SECURITY.md`
- `CODE_OF_CONDUCT.md`
- Issue forms for bugs and features
- A pull request template
- Dependabot configuration
- Release and CodeQL workflows

Repository settings will enable automatic head-branch deletion and Discussions
if the current account supports them. Existing stashes are user-owned and will
not be deleted as part of cleanup.

## Error Handling and Safety

- Build and validation scripts use explicit errors with actionable messages.
- External command failures preserve their exit code and do not fall through to
  publication.
- Registry identity, version, and authentication are checked before a publish
  attempt.
- Release workflows use a protected `npm` environment and concurrency control
  so only one publish can run at a time.
- The workflow checks whether a version already exists and exits safely instead
  of attempting a duplicate publish.
- No build step logs environment variables, tokens, credential files, or secret
  scanner values.
- GitHub setting changes are applied only after their required checks exist and
  have succeeded at least once.

## Acceptance Criteria

The baseline is publication-ready only when all of the following are proven:

1. Local `main` ancestry and the target GitHub branch are understood, with no
   user work overwritten.
2. Production audit has zero critical and high advisories.
3. GitHub secret scanning has no unexplained open alerts.
4. Lint, type-check, tests, builds, and integration checks pass without ignored
   failures.
5. Landing build performs real TypeScript validation and uses valid assets.
6. MCPB builds from a clean checkout without a platform-specific hardcoded tool
   path.
7. npm staging is recreated from source and contains no copied `node_modules` or
   native binaries.
8. `npm pack --dry-run`, package validation, temporary installation, CLI version,
   and MCP handshake checks pass.
9. The tarball installs and passes smoke tests on Linux, macOS, and Windows CI.
10. Package metadata and active documentation use the canonical GitHub and live
    application URLs and the MIT license.
11. CI, CodeQL, Dependabot, contribution templates, security guidance, and
    branch protection are present and verified in GitHub.
12. The release workflow validates tags, publishes with trusted OIDC after the
    one-time bootstrap, provides provenance, verifies the registry artifact,
    and creates a GitHub release.
13. README developer links and real badges resolve. npm version and download
    badges are added after the package exists.
14. A fresh-clone verification run documents the exact commands and results.

## Rollout

Implementation proceeds in the four slices listed in this design. Each slice
gets its own focused commit after its tests pass. Repository settings are
changed last, after the branch demonstrates the checks they will require.

The only expected external handoff is npm bootstrap ownership. If no local npm
session can claim `codegraph-mcp`, all code, CI, documentation, and dry-run
verification still proceed. The final bootstrap publish pauses at the login or
registry ownership boundary and reports the exact remaining action without
weakening the release workflow.
