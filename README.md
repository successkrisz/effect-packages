# effect-packages

[![CI](https://github.com/successkrisz/effect-packages/actions/workflows/ci.yml/badge.svg)](https://github.com/successkrisz/effect-packages/actions/workflows/ci.yml) [![Checked with Biome](https://img.shields.io/badge/Checked_with-Biome-60a5fa?style=flat&logo=biome)](https://biomejs.dev)

Useful Effect libraries

## Packages

- [`effect-lambda`](packages/effect-lambda/README.md) -- Effect-friendly AWS Lambda wrappers and utilities.
- [`effect-oauth-client`](packages/effect-oauth-client/README.md) -- OAuth 2.0 Client Credentials `HttpClient` wrapper for Effect v4 HTTP.
- [`effect-problem-json`](packages/effect-problem-json/README.md) -- RFC 9457 problem details (`application/problem+json`) for Effect v4 `HttpApi`.

### effect-lambda quickstart

```ts
import { toLambdaHandler } from "effect-lambda/RestApi"
import { Effect, Layer } from "effect"

export const handler = toLambdaHandler(
  Effect.succeed({ statusCode: 200, body: "ok" })
)({ layer: Layer.empty })
```

### effect-oauth-client quickstart

```ts
import { OAuthHttpClient } from "@ballatech/effect-oauth-client"
import { Effect, Redacted } from "effect"
import { FetchHttpClient } from "effect/http"

const program = Effect.gen(function* () {
  const client = yield* OAuthHttpClient.make({
    clientId: "my-client-id",
    clientSecret: Redacted.make("my-secret"),
    tokenUrl: "https://auth.example.com/oauth/token",
  })
  yield* client.get("https://api.example.com/secret-foo").pipe(Effect.scoped)
})

Effect.runPromise(program.pipe(Effect.provide(FetchHttpClient.layer)))
```

### effect-problem-json quickstart

```ts
import { HttpApiProblemDetail as ProblemDetail } from "@ballatech/effect-problem-json"
import { Effect } from "effect"
import { HttpApiEndpoint } from "effect/http-api"

const getTodo = HttpApiEndpoint.get("getTodo", "/todos/:id", {
  error: ProblemDetail.NotFound,
})

Effect.fail(new ProblemDetail.NotFound({
  detail: `Todo ${id} was not found`,
}))
```

## Development

- `pnpm new <package-name>` to create a new package
- After making changes, run `pnpm pack:check` to verify the package is built correctly
- Create a new branch
- Create a changeset with `pnpm changeset` choose package(s) and bump type, write summary
- `git add .changeset && git commit -m "chore: changeset"` && `git push`
- Happy days!
