---
id: knowledge-001
title: "Q4 retro: retry policy decision for requests library"
author: alice@example.com
valid_at: 2025-12-10T10:00:00Z
references:
  - sessions.py#prepare_request
  - adapters.py#HTTPAdapter
  - adapters.py#send
category: meeting-notes
---

## Attendees
Alice, Bob, Carol

## Agenda
Review retry behavior for failed HTTP connections in the SDK wrapper we ship over `requests`.

## Discussion
The current retry logic lives outside the library — we call `Session.send` and catch transport errors ourselves. Bob proposed moving retries into a custom `HTTPAdapter` subclass, overriding `send` to add exponential backoff. This avoids duplicating retry state across callers.

Carol raised that `prepare_request` builds the `PreparedRequest` object and runs all request hooks before `send` is called. Retrying at the adapter level means hooks don't re-run on each attempt, which is the behavior we want (no duplicate side effects on auth hooks).

## Decision
We will subclass `HTTPAdapter` and override `send` with retry logic. Max 3 retries, exponential backoff starting at 500ms, retry only on `ConnectionError` and 5xx responses. Ship in sprint 14.

## Action Items
- Alice: draft the adapter subclass by Dec 17
- Bob: write regression tests for hook-not-re-running behavior
- Carol: update runbook with new retry defaults
