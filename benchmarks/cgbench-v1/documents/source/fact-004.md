# Notification service SLA

The Notification service delivers email, SMS, and push alerts. The SLA below governs delivery latency and error budget for the v2 service launched in February 2026.

| key | value |
|---|---|
| availability-target | 99.5% |
| email-delivery-p95-seconds | 30 |
| sms-delivery-p95-seconds | 10 |
| push-delivery-p95-seconds | 5 |
| max-retries | 5 |
| dead-letter-after-hours | 24 |
| owner | notifications-team@example.com |
