---
id: knowledge-004
title: "Ticket: clap argument parsing breaks on empty --config value"
author: dave@example.com
valid_at: 2026-01-22T15:45:00Z
references:
  - command.rs#Command
  - arg.rs#Arg
  - arg_matches.rs#ArgMatches
category: ticket
---

## Summary

When the user passes `--config ""` (empty string), `ArgMatches.get_one::<String>("config")` returns `Some("")` instead of triggering the `required(true)` validator. The CLI silently proceeds with an empty config path, leading to a confusing "file not found" error rather than a usage error.

## Reproduction

```
./my-cli --config ""
# Expected: error: the argument '--config <FILE>' requires a value
# Got: Error: config file not found: ""
```

## Root Cause

`Command::arg` registers the argument with `Arg::required(true)` but `required` only checks presence, not emptiness. An empty string passes the presence check. We need to add `.value_parser(NonEmptyStringValueParser::new())` to the `Arg` definition.

## Impact

Low severity, but confusing UX. Users on Windows passing unquoted empty args hit this most often.

## Fix

Add `Arg::new("config").required(true).value_parser(NonEmptyStringValueParser::new())` to the `Command` definition. Validate in the arg definition, not post-match.

## Owner
Dave — target sprint 18
