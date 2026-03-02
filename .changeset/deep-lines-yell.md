---
"@ballatech/effect-oauth-client": minor
---

Rename module export from `OAuthClient` to `OAuthHttpClient` to better communicate that this package provides an OAuth-authenticated HttpClient, not a generic OAuth client. The source file is also renamed to `OAuthHttpClient.ts` to align with Effect v4's convention of matching file names to their primary export. This is a breaking change — update imports from `{ OAuthClient }` to `{ OAuthHttpClient }`.
