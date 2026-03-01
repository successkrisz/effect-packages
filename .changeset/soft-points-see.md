---
"@ballatech/effect-oauth-client": minor
---

Retry on 401 and transient token endpoint failures

- Downstream 401 responses now invalidate the cached token and retry the request once with a fresh token. If the retry also returns 401, the error propagates as `AuthorizationError` with code `unauthorized`.
- Token endpoint transient errors (429 rate limiting, 5xx server errors, network failures) are now retried up to 2 times with exponential backoff (200ms, 400ms). Permanent errors (4xx bad credentials/scope) still fail immediately.
- Error classification now uses `Schema.isSchemaError` instead of a brittle `_tag` string check.
