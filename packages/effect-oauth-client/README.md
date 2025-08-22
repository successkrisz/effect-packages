# effect-oauth-client

[![npm version](https://img.shields.io/npm/v/%40ballatech%2Feffect-oauth-client)](https://www.npmjs.com/package/@ballatech/effect-oauth-client)

Effect-first OAuth 2.0 Client Credentials helper for `@effect/platform`'s `HttpClient`.

- Fetches access tokens using the client credentials grant
- Caches tokens and auto-refreshes near expiry
- Transparently attaches `Authorization: Bearer <token>` to outgoing requests
- Retries once on 401 responses

## Installation

```bash
pnpm add @ballatech/effect-oauth-client
```

This package expects `effect` and `@effect/platform` to be available as peers.

```bash
pnpm add effect @effect/platform
```

## API

```ts
import { OAuthClient } from "effect-oauth-client"
```

- `OAuthClient.make(credentials)` → `Effect<HttpClient>`
  - Builds an `HttpClient` that automatically obtains and injects access tokens.

### Credentials

```ts
type Credentials = {
  clientId: string
  clientSecret: Redacted.Redacted<string>
  tokenUrl: string
  scope?: string
  audience?: string
  ttl?: Duration.Duration // default: 3600 seconds
}
```

Notes:

- `ttl` controls the cache TTL for the token effect. Actual token expiry is respected via the `expires_in` value and refreshed ~10 seconds early.
- `scope` and `audience` are optional and sent as URL-encoded form parameters.

### Errors

`OAuthClient` can fail with `AuthorizationError` (a tagged error) with `code`:

- `credentials_error`: parsing or validation of the token response failed
- `client_error`: HTTP client or response error while obtaining a token
- `unauthorized`: downstream API responded with 401

## Usage

### Basic request

```ts
import { OAuthClient } from "effect-oauth-client"
import { Effect, Redacted, Schema } from "effect"
import { FetchHttpClient, HttpClientResponse } from "@effect/platform"

const FooSchema = Schema.Struct({ foo: Schema.String })

const program = Effect.gen(function* () {
  const client = yield* OAuthClient.make({
    clientId: "my-client-id",
    clientSecret: Redacted.make("my-secret"),
    tokenUrl: "https://auth.example.com/oauth/token",
    scope: "read:foo",
  })

  // The client now automatically includes a Bearer token
  const result = yield* client
    .get("https://api.example.com/secret-foo")
    .pipe(
      Effect.flatMap(HttpClientResponse.schemaBodyJson(FooSchema)),
      Effect.scoped
    )

  return result
})

// Provide an HttpClient implementation (Fetch)
Effect.runPromise(program.pipe(Effect.provide(FetchHttpClient.layer)))
```

### With Layer and service composition

```ts
import { Context, Effect, Layer, Redacted } from "effect"
import { OAuthClient } from "effect-oauth-client"
import { FetchHttpClient, HttpClientResponse } from "@effect/platform"

const makeService = Effect.gen(function* () {
  const client = yield* OAuthClient.make({
    clientId: "id123",
    clientSecret: Redacted.make("secret"),
    tokenUrl: "https://auth.example.com/oauth/token",
  })
  const getFoo = () =>
    client.get("https://api.example.com/secret-foo").pipe(Effect.scoped)
  return { getFoo }
})

class MyService extends Context.Tag("MyService")<
  MyService,
  Effect.Effect.Success<typeof makeService>
>() {}

export const MyServiceLayer = Layer.effect(MyService, makeService).pipe(
  Layer.provide(FetchHttpClient.layer)
)
```

### Testing (mocking Fetch)

```ts
import { beforeEach, describe, expect, it, vi } from "@effect/vitest"
import { Duration, Effect, Layer, ManagedRuntime, Redacted } from "effect"
import { FetchHttpClient } from "@effect/platform"
import { OAuthClient } from "effect-oauth-client"

describe("OAuthClient", () => {
  let rt: ManagedRuntime.ManagedRuntime<never, never>
  const fetch = vi.fn()

  beforeEach(() => {
    fetch.mockReset()
    const FetchTest = Layer.succeed(FetchHttpClient.Fetch, fetch)
    rt = ManagedRuntime.make(FetchHttpClient.layer.pipe(Layer.provide(FetchTest)))
  })

  it("fetches and reuses token", async () => {
    fetch.mockImplementation(async (url: URL) => {
      if (url.href.includes("/oauth/token")) {
        return new Response(JSON.stringify({ access_token: "t", token_type: "Bearer", expires_in: 3600 }), { status: 200 })
      }
      return new Response(JSON.stringify({ ok: true }), { status: 200 })
    })

    const prog = Effect.gen(function* () {
      const client = yield* OAuthClient.make({
        clientId: "id",
        clientSecret: Redacted.make("secret"),
        tokenUrl: "https://auth.example.com/oauth/token",
        ttl: Duration.seconds(3600),
      })
      yield* client.get("https://api.example.com/foo").pipe(Effect.scoped)
      yield* client.get("https://api.example.com/foo").pipe(Effect.scoped)
    })

    await rt.runPromise(prog)
  })
})
```

## Requirements

- Provide an `HttpClient` layer, e.g. `FetchHttpClient.layer`
- `effect` and `@effect/platform` must be installed (peer dependencies)

## Build

```bash
pnpm -w build
```
