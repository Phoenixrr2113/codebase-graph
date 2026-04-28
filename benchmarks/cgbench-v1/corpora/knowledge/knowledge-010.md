---
id: knowledge-010
title: "Sprint 11 planning: clap subcommand dispatch refactor"
author: dave@example.com
valid_at: 2026-03-28T10:00:00Z
references:
  - command.rs#Command
  - arg_matches.rs#ArgMatches
  - command.rs#get_matches
category: meeting-notes
---

## Attendees
Dave, Bob, Alice

## Goals

Refactor CLI dispatch to separate argument parsing from command execution. Current code calls `Command::get_matches` and then branches on `ArgMatches::subcommand_name` inline in `main`, mixing parse and execute.

## Discussion

Dave proposed a dispatch table: each subcommand registers a handler `fn(&ArgMatches) -> ExitCode`. After `get_matches`, we look up the matched subcommand name in the table and call the handler. No more inline branching.

Alice noted that `ArgMatches::subcommand` returns `Option<(&str, &ArgMatches)>` — both the name and a sub-match slice come out together. The dispatch table should accept the sub-match slice, not the root `ArgMatches`, so subcommand handlers don't accidentally read flags from sibling subcommands.

Bob: global flags (from `Arg::global(true)`) ARE accessible on the sub-match slice, so handlers don't need the root matches at all.

## Decisions

- Dispatch table pattern adopted for sprint 11.
- Handlers receive `&ArgMatches` (sub-slice) and `&Config` (loaded from global flags before dispatch).
- No handler may call `get_matches` — parsing is fully owned by `main`.

## Action Items
- Dave: implement dispatch table and migrate `run` subcommand by Apr 4
- Bob: migrate `report` and `clean` subcommands by Apr 7
