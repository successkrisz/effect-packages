# effect-oauth-client

[![npm version](https://img.shields.io/npm/v/%40ballatech%2Feffect-oauth-client)](https://www.npmjs.com/package/@ballatech/effect-oauth-client) [![Checked with Biome](https://img.shields.io/badge/Checked_with-Biome-60a5fa?style=flat&logo=biome)](https://biomejs.dev)

Effect-first OAuth 2.0 Client Credentials helper for Effect v4 HTTP `HttpClient`.

> [!WARNING]
> **This version targets [Effect v4 beta](https://github.com/Effect-TS/effect-smol) (`effect@4.0.0-beta.*`).** The APIs use v4 constructs such as `ServiceMap.Service`, `ManagedRuntime`, and `effect/unstable/http`. If you are on Effect v3, use an earlier version of this package.
>
> See the [Effect v4 Beta announcement](https://effect.website/blog/releases/effect/40-beta/) for details.

- Fetches access tokens using the client credentials grant
- Caches tokens and auto-refreshes near expiry
- Transparently attaches `Authorization: Bearer <token>` to outgoing requests
- Retries once on downstream 401 responses (invalidates cached token, fetches a fresh one)
- Retries transient token endpoint failures (429, 5xx, network errors) with exponential backoff

## Installation

```bash
pnpm add @ballatech/effect-oauth-client
```

This package expects `effect` v4 beta as a peer. Since `pnpm add effect` installs v3 by default, you must specify the beta tag explicitly:

```bash
pnpm add effect@beta
```

## API

```ts
import { OAuthClient } from "@ballatech/effect-oauth-client"
```

- `OAuthClient.make(credentials)` → `Effect<HttpClient>`
  - Builds an `HttpClient` that automatically obtains and injects access tokens.
- `OAuthClient.makeFromConfig(credentialsConfig)` → `Effect<HttpClient>`
  - Same as `make`, but resolves each credential from a `Config` value. Useful when credentials come from environment variables or a config provider.
- `OAuthClient.layer(credentials)` → `Layer<OAuthHttpClient>`
  - Provides an `OAuthHttpClient` service from static credentials.
- `OAuthClient.layerFromConfig(credentialsConfig)` → `Layer<OAuthHttpClient>`
  - Provides an `OAuthHttpClient` service from `Config` values.
- `OAuthClient.OAuthHttpClient` — Built-in service tag for the single-client case. Use with `layer` / `layerFromConfig`.
- `OAuthClient.Client` — Type alias for the authenticated `HttpClient` shape. Use this when creating your own service tags for multi-client setups.
- `OAuthClient.AuthorizationError` — Tagged error class for all OAuth failures. Has a `code` field: `'credentials_error'`, `'client_error'`, or `'unauthorized'`.
- `OAuthClient.isAuthorizationError(u)` — Type guard that narrows `unknown` to `AuthorizationError`.

### Credentials

```ts
type Credentials = {
  clientId: string
  clientSecret: Redacted.Redacted<string>
  tokenUrl: string
  scope?: string
  audience?: string
  baseUrl?: string            // prepended to all outgoing request URLs
  ttl?: Duration.Duration     // default: 3600 seconds
  expiryBuffer?: Duration.Duration // default: 300 seconds (refresh ~5m early)
}
```

Notes:

- `baseUrl` is prepended to every outgoing request URL, so you can use relative paths like `client.get("/users")` instead of full URLs.
- `ttl` controls the maximum cache lifetime for the token. The actual token expiry from `expires_in` is also tracked, and the token is proactively refreshed `expiryBuffer` before it expires (default: 5 minutes early).
- `scope` and `audience` are optional and sent as URL-encoded form parameters.

### CredentialsConfig

`makeFromConfig` accepts `Config` values for fields that typically come from the environment:

```ts
type CredentialsConfig = {
  clientId: Config.Config<string>
  clientSecret: Config.Config<Redacted.Redacted<string>>
  tokenUrl: Config.Config<string>
  scope?: Config.Config<string>
  audience?: Config.Config<string>
  baseUrl?: Config.Config<string>
  ttl?: Duration.Duration
  expiryBuffer?: Duration.Duration
}
```

### Errors

`OAuthClient` can fail with `AuthorizationError` (a tagged error) with `code`:

- `credentials_error`: the token endpoint returned a response that doesn't match the expected schema (e.g. 400 with an OAuth error body, or missing `access_token`). Not retried.
- `client_error`: transient failure while obtaining a token (network error, 429, 5xx). Retried up to 2 times with exponential backoff before failing.
- `unauthorized`: downstream API responded with 401. The cached token is invalidated and the request is retried once with a fresh token. If the retry also returns 401, the error propagates.

## Usage

### Basic request

```ts
import { OAuthClient } from "@ballatech/effect-oauth-client"
import { Effect, Redacted, Schema } from "effect"
import { FetchHttpClient, HttpClientResponse } from "effect/unstable/http"

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
import { Effect, Layer, Redacted, ServiceMap } from "effect"
import { OAuthClient } from "@ballatech/effect-oauth-client"
import { FetchHttpClient, HttpClientResponse } from "effect/unstable/http"

const makeService = Effect.gen(function* () {
  const client = yield* OAuthClient.make({
    clientId: "id123",
    clientSecret: Redacted.make("secret"),
    tokenUrl: "https://auth.example.com/oauth/token",
    baseUrl: "https://api.example.com",
  })
  const getFoo = () =>
    client.get("/secret-foo").pipe(Effect.scoped)
  return { getFoo }
})

type MyServiceShape = Effect.Success<typeof makeService>
class MyService extends ServiceMap.Service<MyService, MyServiceShape>()("MyService") {}

export const MyServiceLayer = Layer.effect(MyService)(makeService).pipe(
  Layer.provide(FetchHttpClient.layer)
)
```

### With `layer` (zero-boilerplate single client)

```ts
import { Effect, Layer, Redacted } from "effect"
import { OAuthClient } from "@ballatech/effect-oauth-client"
import { FetchHttpClient, HttpClientResponse } from "effect/unstable/http"

const AppLayer = OAuthClient.layer({
  clientId: "id123",
  clientSecret: Redacted.make("secret"),
  tokenUrl: "https://auth.example.com/oauth/token",
  baseUrl: "https://api.example.com",
}).pipe(Layer.provide(FetchHttpClient.layer))

const program = OAuthClient.OAuthHttpClient.use((client) =>
  client.get("/secret-foo").pipe(Effect.scoped)
)

Effect.runPromise(program.pipe(Effect.provide(AppLayer)))
```

### With Config provider (environment variables)

Using `layerFromConfig` for the simplest case:

```ts
import { Config, Effect, Layer } from "effect"
import { OAuthClient } from "@ballatech/effect-oauth-client"
import { FetchHttpClient } from "effect/unstable/http"

const AppLayer = OAuthClient.layerFromConfig({
  clientId: Config.string("OAUTH_CLIENT_ID"),
  clientSecret: Config.redacted("OAUTH_CLIENT_SECRET"),
  tokenUrl: Config.string("OAUTH_TOKEN_URL"),
  baseUrl: Config.string("API_BASE_URL"),
  scope: Config.string("OAUTH_SCOPE"),
}).pipe(Layer.provide(FetchHttpClient.layer))

const program = OAuthClient.OAuthHttpClient.use((client) =>
  client.get("/secret-foo").pipe(Effect.scoped)
)

Effect.runPromise(program.pipe(Effect.provide(AppLayer)))
```

Or with `makeFromConfig` when wrapping in a custom service:

```ts
import { Config, Effect, Layer, ServiceMap } from "effect"
import { OAuthClient } from "@ballatech/effect-oauth-client"
import { FetchHttpClient } from "effect/unstable/http"

const makeService = Effect.gen(function* () {
  const client = yield* OAuthClient.makeFromConfig({
    clientId: Config.string("OAUTH_CLIENT_ID"),
    clientSecret: Config.redacted("OAUTH_CLIENT_SECRET"),
    tokenUrl: Config.string("OAUTH_TOKEN_URL"),
    baseUrl: Config.string("API_BASE_URL"),
  })
  const getFoo = () =>
    client.get("/secret-foo").pipe(Effect.scoped)
  return { getFoo }
})

type MyServiceShape = Effect.Success<typeof makeService>
class MyService extends ServiceMap.Service<MyService, MyServiceShape>()("MyService") {}

export const MyServiceLayer = Layer.effect(MyService)(makeService).pipe(
  Layer.provide(FetchHttpClient.layer)
)
```

### Multiple OAuth clients

The built-in `OAuthHttpClient` tag covers the single-client case. When your program
connects to multiple OAuth-protected APIs, create a dedicated tag for each one using
`OAuthClient.Client` as the shape:

```ts
import { Effect, Layer, Redacted, ServiceMap } from "effect"
import { OAuthClient } from "@ballatech/effect-oauth-client"
import { FetchHttpClient } from "effect/unstable/http"

class AzureClient extends ServiceMap.Service<AzureClient, OAuthClient.Client>()("AzureClient") {
  static live = Layer.effect(this)(OAuthClient.make({
    clientId: "azure-id",
    clientSecret: Redacted.make("azure-secret"),
    tokenUrl: "https://login.microsoftonline.com/.../oauth2/v2.0/token",
    baseUrl: "https://api.azure.example.com",
  }))
}

class GoogleClient extends ServiceMap.Service<GoogleClient, OAuthClient.Client>()("GoogleClient") {
  static live = Layer.effect(this)(OAuthClient.make({
    clientId: "google-id",
    clientSecret: Redacted.make("google-secret"),
    tokenUrl: "https://oauth2.googleapis.com/token",
    baseUrl: "https://api.google.example.com",
  }))
}

const program = Effect.gen(function* () {
  const azure = yield* AzureClient
  const google = yield* GoogleClient

  const azureData = yield* azure.get("/data").pipe(Effect.scoped)
  const googleData = yield* google.get("/data").pipe(Effect.scoped)
})

const AppLayer = Layer.mergeAll(AzureClient.live, GoogleClient.live).pipe(
  Layer.provide(FetchHttpClient.layer)
)

Effect.runPromise(program.pipe(Effect.provide(AppLayer)))
```

### Testing (mocking Fetch)

```ts
import { beforeEach, describe, expect, it, vi } from "@effect/vitest"
import { Duration, Effect, Layer, ManagedRuntime, Redacted } from "effect"
import { FetchHttpClient } from "effect/unstable/http"
import { OAuthClient } from "@ballatech/effect-oauth-client"

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
- `effect@4.0.0-beta.*` must be installed (peer dependency) — install with `pnpm add effect@beta`

## Build

```bash
pnpm -w build
```
