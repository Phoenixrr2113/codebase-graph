# Security Policy

## Supported versions

Security fixes are provided for the current minor release line.

| Version | Supported |
| --- | --- |
| 0.1.x | Yes |
| Earlier versions | No |

## Report a vulnerability

Use GitHub's [private vulnerability reporting form](https://github.com/Phoenixrr2113/codebase-graph/security/advisories/new). Do not open a public issue containing exploit details, credentials, private source code, or other sensitive data.

Include affected versions, impact, reproduction steps, and any suggested mitigation. Remove real credentials and personal data from logs or examples.

The maintainer will aim to acknowledge a report within 72 hours, provide status updates while it is investigated, and coordinate disclosure after a fix is available. Response and remediation timing depend on severity and reproducibility.

## Known advisories in the package dependency tree

`npm audit` reports findings against `@agntk/codegraph-mcp` that we cannot resolve from this
repository. They are listed here rather than suppressed, and the release pipeline enforces
the list: `pnpm audit:consumer` resolves the dependency tree an end user actually installs
and fails on any unacknowledged advisory at high severity or above. An acknowledgement that
stops matching a real advisory also fails the build, so this list cannot go stale silently.

### sharp (GHSA-f88m-g3jw-g9cj), high

`sharp` versions below 0.35.0 inherit libvips vulnerabilities CVE-2026-33327, CVE-2026-33328,
CVE-2026-35590 and CVE-2026-35591. `@agntk/codegraph-mcp` does not depend on `sharp` directly. It
arrives through `@huggingface/transformers`, which declares `sharp ^0.34.x` in every
published release from 3.8.1 through 4.2.0, so no upstream version of that package resolves
to a patched `sharp`.

CodeGraph uses `@huggingface/transformers` only for text embeddings and never calls its
image processing path, so the affected code is installed but not exercised. This repository
pins a patched `sharp` for its own workspace through `pnpm.overrides`, but package manager
overrides are not inherited by consumers, which is why the advisory still appears in a
consumer `npm audit`.

Last reviewed 2026-08-19. This entry is removed once `@huggingface/transformers` widens its
`sharp` range.
