# Historical Commercial Distribution Strategy

> Superseded on 2026-08-18 by the [publication-ready baseline](superpowers/specs/2026-08-18-publication-ready-baseline-design.md). This file is retained only as decision history. It is not an active product, licensing, packaging, or release plan.

## Previous direction

The original March 2026 proposal assumed a private source repository, Bun-compiled platform binaries, paid license keys, and Polar-hosted downloads. It explored source protection, per-seat pricing, Merchant of Record services, cached online license validation, and later marketplace distribution.

## Why it was replaced

The repository is now public under the MIT License. The active baseline favors:

- a public `codegraph-mcp` npm package;
- source and issue tracking in `Phoenixrr2113/codebase-graph`;
- reproducible tarball validation and cross-platform consumer smoke tests;
- a platform-local MCPB artifact;
- npm trusted publishing through GitHub Actions OIDC;
- no runtime license key, payment gate, or closed-binary claim.

The abandoned plan's useful lesson is that distribution must be tested as an installed artifact, not inferred from a source build. That principle remains in the npm and MCPB release gates.

## Current authority

- [Publication baseline design](superpowers/specs/2026-08-18-publication-ready-baseline-design.md)
- [Distribution and release setup](DISTRIBUTION-SETUP.md)
- [Launch checklist](distribution/launch-checklist.md)
- [Root README](../README.md)

Any references elsewhere to Polar, commercial license keys, a private repository, or `codegraph.dev` are historical unless a future approved design explicitly restores them.
