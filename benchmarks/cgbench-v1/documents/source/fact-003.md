# Search API service-level agreement

The Search API SLA defines availability, latency, and retry behaviour for all consumers of the service. These targets apply to production traffic only.

| key | value |
|---|---|
| availability-target | 99.9% |
| p99-latency-ms | 500 |
| p50-latency-ms | 120 |
| max-retries | 3 |
| retry-backoff-ms | 200 |
| timeout-ms | 5000 |
| owner | platform-team@example.com |
