# @ballatech/effect-problem-json

[RFC 9457](https://www.rfc-editor.org/rfc/rfc9457.html) Problem Details for HTTP APIs, implemented as reusable building blocks for Effect v4 `HttpApi`.

## Install

```bash
pnpm add @ballatech/effect-problem-json
```

`effect` is a peer dependency.

## Quick start

`HttpApiProblemDetail` is the canonical namespace for this package.

```ts
import { HttpApiProblemDetail as ProblemDetail } from "@ballatech/effect-problem-json"
```

### Built-in errors

Built-ins are constructor values. Use them directly in `HttpApiEndpoint` definitions and instantiate them in handlers:

```ts
const getTodo = HttpApiEndpoint.get("getTodo", "/todos/:id", {
  error: ProblemDetail.NotFound,
})

Effect.fail(new ProblemDetail.NotFound({
  detail: `Todo ${id} was not found`,
}))
```

Available pre-builts: `BadRequest`, `Unauthorized`, `PaymentRequired`, `Forbidden`, `NotFound`, `MethodNotAllowed`, `Conflict`, `Gone`, `UnprocessableContent`, `TooManyRequests`, `InternalServerError`, `NotImplemented`, `BadGateway`, `ServiceUnavailable`, and `GatewayTimeout`.

### Custom errors

Use `ProblemError(tag, status)` to create a constructor with RFC 9457 defaults and `application/problem+json` encoding:

```ts
import { Schema } from "effect"
import { HttpApiProblemDetail as ProblemDetail } from "@ballatech/effect-problem-json"

const DuplicateTitle = ProblemDetail.ProblemError("DuplicateTitle", 422)({
  existingId: Schema.Number,
})

const createTodo = HttpApiEndpoint.post("createTodo", "/todos", {
  error: DuplicateTitle,
})

Effect.fail(new DuplicateTitle({
  detail: "A todo with this title already exists",
  existingId: 42,
}))
```

### Validation problems

`formatSchemaIssues` gives you structured validation details, and `ValidationProblem` turns `SchemaError`s into problem details:

```ts
yield* Schema.decodeUnknownEffect(MySchema)(body).pipe(
  Effect.mapError((error) =>
    ProblemDetail.ValidationProblem.fromSchemaError(error, {
      type: "/problems/validation-error",
    }),
  ),
)
```

For plain `HttpRouter` routes:

```ts
Effect.catchTag("SchemaError", (error) =>
  Effect.succeed(ProblemDetail.ValidationProblem.toResponse(error)),
)
```

### Middleware

`middleware()` is still important because Effect `HttpApi` currently hardcodes an empty-body 400 for request validation failures and defaults defects to an empty 500. The middleware fixes both:

1. Catches `SchemaError`s in the error channel for plain `HttpRouter` routes
2. Rewrites empty-body error responses (including the framework's built-in validation 400) to `application/problem+json`
3. Normalizes JSON error responses that already have an RFC 9457 body but the wrong `application/json` content type
4. Rewrites defects to a safe 500 problem detail with no leaked internals

```ts
const AppLive = HttpRouter.serve(
  Layer.mergeAll(ApiLive, ProblemDetail.middleware()),
)
```

### OpenAPI

Effect `HttpApi` also hardcodes its default validation error into every endpoint's error set, so OpenAPI needs a small transform as well:

```ts
import { HttpApi, OpenApi } from "effect/unstable/httpapi"
import { HttpApiProblemDetail as ProblemDetail } from "@ballatech/effect-problem-json"

const api = HttpApi.make("MyApi")
  .add(myGroup)
  .annotate(OpenApi.Transform, ProblemDetail.openApiTransform)
```

This makes generated 400 responses use `application/problem+json` and replaces the default validation schema with an RFC 9457 shape.

## API reference

| Export | Description |
|---|---|
| `statusTitles` | All 4xx/5xx RFC 9110 reason phrases as a `const` object |
| `StatusCode` | Type union of all keys in `statusTitles` |
| `ProblemError(tag, status)` | Creates a problem-detail error constructor with defaults, `httpApiStatus`, and `application/problem+json` encoding |
| `ValidationProblem` | Validation-focused problem-detail constructor with `fromSchemaError()` and `toResponse()` helpers |
| `formatSchemaIssues(error)` | Converts a `Schema.SchemaError` into `Array<{ detail, pointer? }>` |
| `makeResponse(status, detail, options?)` | Creates an ad-hoc problem+json `HttpServerResponse` |
| `middleware(options?)` | Rewrites framework-generated empty-body errors and defects to problem+json |
| `openApiTransform(spec)` | Rewrites generated OpenAPI 400 responses to problem+json |
| `BadRequest`, `NotFound`, ... | Built-in problem-detail error constructors for common statuses |

## Development

The package includes a dev server with a Todo API:

```bash
cd packages/effect-problem-json
pnpm dev
```

That starts a server at `http://localhost:3000` with Swagger UI at `/docs` and the OpenAPI spec at `/openapi.json`.

## License

MIT
