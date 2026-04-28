---
id: knowledge-006
title: "Spec: CLI flag schema using clap Command builder"
author: bob@example.com
valid_at: 2026-02-14T10:00:00Z
references:
  - command.rs#Command
  - arg.rs#Arg
  - arg_matches.rs#ArgMatches
category: spec
---

## Overview

The CLI tool uses clap's `Command` builder API (non-derive) so the argument schema can be constructed dynamically from config files. This document specifies the top-level command structure.

## Command Structure

The root `Command::new("cgbench")` has three subcommands: `run`, `report`, and `clean`. Each subcommand is registered via `Command::subcommand`. Global flags (`--config`, `--verbose`) are added to the root with `Command::arg` and propagated with `.global(true)` on the `Arg`.

## Argument Retrieval

After `Command::get_matches`, callers use `ArgMatches::get_one::<String>` for string flags, `ArgMatches::get_flag` for booleans, and `ArgMatches::subcommand` to dispatch to the matched subcommand handler.

## Constraints

- All required flags must be defined with `Arg::required(true)`. Do not use `unwrap()` on `get_one` without a `required` guard.
- Subcommand handlers receive an `&ArgMatches` slice — they must not call `get_matches` again.
- Help text must be set on every `Arg` via `.help()`. CI will lint for missing help strings.

## Rationale

Prefer builder API over derive macros here because the flag set is partially dynamic. Derive requires compile-time structs; the builder lets us push flags from a loaded TOML config into the `Command` before parsing.
