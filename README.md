# effect-packages

[![CI](https://github.com/successkrisz/effect-packages/actions/workflows/ci.yml/badge.svg)](https://github.com/successkrisz/effect-packages/actions/workflows/ci.yml) [![Checked with Biome](https://img.shields.io/badge/Checked_with-Biome-60a5fa?style=flat&logo=biome)](https://biomejs.dev)

Useful Effect libraries

## Packages

- `effect-lambda`: Effect-friendly AWS Lambda wrappers and utilities.
- `effect-oauth-client`: OAuth 2.0 Client Credentials `HttpClient` wrapper for `@effect/platform`.

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

## Development

- `pnpm new <package-name>` to create a new package
- After making changes, run `pnpm pack:check` to verify the package is built correctly
- Create a new branch
- Create a changeset with `pnpm changeset` choose package(s) and bump type, write summary
- `git add .changeset && git commit -m "chore: changeset"` && `git push`
- Happy days!
