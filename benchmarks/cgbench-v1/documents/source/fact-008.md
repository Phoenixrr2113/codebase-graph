# Incident postmortem: search outage 2026-03-27

On 2026-03-27 the search service was unavailable for 47 minutes due to a misconfigured vector index rebuild that exhausted available memory. The fix was to add a memory guard on index rebuild operations.

| key | value |
|---|---|
| incident-date | 2026-03-27 |
| duration-minutes | 47 |
| severity | P1 |
| root-cause | vector index rebuild exhausted available memory |
| fix | add memory guard on index rebuild |
| incident-commander | eve@example.com |
| follow-up-ticket | PLAT-4821 |
