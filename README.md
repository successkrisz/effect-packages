# effect-packages

[![CI](https://github.com/successkrisz/effect-packages/actions/workflows/ci.yml/badge.svg)](https://github.com/successkrisz/effect-packages/actions/workflows/ci.yml)

Useful Effect libraries

## Packages

- `effect-oauth-client`: OAuth 2.0 Client Credentials `HttpClient` wrapper for `@effect/platform`.

### effect-oauth-client quickstart

```ts
import { OAuthClient } from "effect-oauth-client"
import { Effect, Redacted } from "effect"
import { FetchHttpClient } from "@effect/platform"

const program = Effect.gen(function* () {
  const client = yield* OAuthClient.make({
    clientId: "my-client-id",
    clientSecret: Redacted.make("my-secret"),
    tokenUrl: "https://auth.example.com/oauth/token",
  })
  yield* client.get("https://api.example.com/secret-foo").pipe(Effect.scoped)
})

Effect.runPromise(program.pipe(Effect.provide(FetchHttpClient.layer)))
```
