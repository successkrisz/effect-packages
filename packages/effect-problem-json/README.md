# @ballatech/effect-problem-json

[RFC 9457](https://www.rfc-editor.org/rfc/rfc9457.html) Problem Details for HTTP APIs, implemented as reusable building blocks for Effect v4 `HttpApi`.

## Install

```bash
pnpm add @ballatech/effect-problem-json
```

`effect` is a peer dependency — install it alongside.

## Quick start

### 1. Use pre-built error classes

The fastest way to add problem+json errors. Only `detail` is required — `type`, `title`, and `status` are auto-populated:

```ts
import { Effect } from "effect";
import { ProblemJson } from "@ballatech/effect-problem-json";

// In your HttpApiEndpoint definition
const getTodo = HttpApiEndpoint.get("getTodo", "/todos/:id", {
  error: ProblemJson.NotFound.problem,
});

// In your handler
Effect.fail(ProblemJson.NotFound.make({ detail: `Todo ${id} not found` }));
// → { type: "about:blank", title: "Not Found", status: 404, detail: "Todo 1 not found" }
```

Available pre-builts: `BadRequest` (400), `Unauthorized` (401), `PaymentRequired` (402), `Forbidden` (403), `NotFound` (404), `MethodNotAllowed` (405), `Conflict` (409), `Gone` (410), `UnprocessableContent` (422), `TooManyRequests` (429), `InternalServerError` (500), `NotImplemented` (501), `BadGateway` (502), `ServiceUnavailable` (503), `GatewayTimeout` (504).

### 2. Custom errors with `makeErrorClass`

When you need a custom tag or extension fields:

```ts
import { Schema } from "effect";
import { ProblemJson } from "@ballatech/effect-problem-json";

const DuplicateTitle = ProblemJson.makeErrorClass("DuplicateTitle", 422, {
  existingId: Schema.Number,
});

// Endpoint definition
const createTodo = HttpApiEndpoint.post("createTodo", "/todos", {
  error: DuplicateTitle.problem,
});

// Handler
Effect.fail(
  DuplicateTitle.make({
    detail: "A todo with this title already exists",
    existingId: 42,
  }),
);
// → { type: "about:blank", title: "Unprocessable Content", status: 422,
//     detail: "A todo with this title already exists", existingId: 42 }
```

### 3. Manual `errorFields` + `asProblemJson` (low-level)

For full control, define a `Schema.ErrorClass` directly. With the new defaults, only `detail` is required at construction:

```ts
class TodoNotFound extends Schema.ErrorClass<TodoNotFound>("TodoNotFound")(
  ProblemJson.errorFields(404),
  { httpApiStatus: 404 },
) {}

const TodoNotFoundProblem = ProblemJson.asProblemJson(TodoNotFound);

new TodoNotFound({ detail: "Not found" });
// type → "about:blank", title → "Not Found", status → 404 (all auto-populated)
```

### 4. Schema validation errors (composable)

Export `formatSchemaIssues` and `ValidationErrorItem` for composable schema error handling:

```ts
const MyValidationError = ProblemJson.makeErrorClass("ValidationError", 400, {
  errors: Schema.Array(ProblemJson.ValidationErrorItem),
  traceId: Schema.optional(Schema.String),
});

// In an HttpApi handler
yield* Schema.decodeUnknownEffect(MySchema)(body).pipe(
  Effect.mapError((e) =>
    MyValidationError.make({
      detail: "The request did not match the expected schema",
      errors: ProblemJson.formatSchemaIssues(e),
      traceId: currentTraceId,
    }),
  ),
);
```

For non-HttpApi routes, use `fromSchemaError` to get an `HttpServerResponse` directly:

```ts
Effect.catchTag("SchemaError", (error) =>
  Effect.succeed(ProblemJson.fromSchemaError(error)),
);
```

### 5. Apply the middleware

The middleware does three things in one:

1. **Catches `Schema.SchemaError`** at the Effect level — before it becomes an empty 400 — producing structured validation details with JSON Pointer paths
2. **Transforms remaining 4xx responses** (empty-body or JSON) into `application/problem+json`
3. **Catches unhandled defects** with a safe 500 response

```ts
import { Layer } from "effect";
import { HttpRouter } from "effect/unstable/http";
import { ProblemJson } from "@ballatech/effect-problem-json";

const AppLive = HttpRouter.serve(
  Layer.mergeAll(ApiLive, ProblemJson.middleware()),
);
```

Schema validation failures produce rich error details automatically:

```json
{
  "type": "/problems/schema-error",
  "title": "Bad Request",
  "status": 400,
  "detail": "The request did not match the expected schema",
  "errors": [
    { "detail": "Expected string, got 42", "pointer": "#/name" }
  ]
}
```

### 6. Patch the OpenAPI spec

```ts
import { HttpApi, OpenApi } from "effect/unstable/httpapi";
import { ProblemJson } from "@ballatech/effect-problem-json";

const api = HttpApi.make("MyApi")
  .add(myGroup)
  .annotate(OpenApi.Transform, ProblemJson.openApiTransform);
```

This replaces the generated `effect_HttpApiSchemaError` schema with an RFC 9457-compliant one and swaps the 400 response content type to `application/problem+json`.

## API reference

| Export | Description |
|---|---|
| `statusTitles` | All 4xx/5xx RFC 9110 reason phrases as a `const` object |
| `StatusCode` | Type union of all keys in `statusTitles` (e.g. `400 \| 401 \| ...`) |
| `Extensions` | Type for extension fields — forbids collisions with base problem keys |
| `errorFields(status)` | RFC 9457 schema fields with constructor defaults for `type`, `title`, `status` — only `detail` required |
| `asProblemJson(schema)` | Sets the content type to `application/problem+json` via `HttpApiSchema.asJson` |
| `makeErrorClass(tag, status, extensions?)` | One-call helper → `{ Error, problem, make }` combining `Schema.ErrorClass` + `asProblemJson` + extensions |
| `makeResponse(status, detail, options?)` | Creates an ad-hoc `HttpServerResponse` with problem+json body; supports `extensions` |
| `fromSchemaError(error, options?)` | Creates a problem+json response from a `Schema.SchemaError`; supports `extensions` |
| `formatSchemaIssues(error)` | Converts a `Schema.SchemaError` into `Array<{ detail, pointer? }>` for composable use |
| `ValidationErrorItem` | Schema for a single validation error (`{ detail: string, pointer?: string }`) |
| `parseSchemaErrors(message)` | Parses Effect schema error message strings into `Array<{ detail, pointer? }>` |
| `transformResponse(response, options?)` | Rewrites a 4xx response (empty-body or JSON) into `application/problem+json` |
| `middleware(options?)` | Global middleware — catches SchemaErrors with structured details, rewrites 4xx responses, and catches defects with a safe 500 |
| `openApiTransform(spec)` | Transforms a generated OpenAPI spec to use problem+json for error responses |
| `BadRequest`, `NotFound`, ... | Pre-built error classes for 15 common HTTP error statuses |

### Options

Both `middleware` and `transformResponse` accept an optional `typePrefix` (default `"/problems/"`) used to build the problem `type` URI from the error's `_tag`.

Both `makeResponse` and `fromSchemaError` accept an optional `extensions` record that gets flat-spread into the response body (base fields overwrite on collision).

### How the middleware catches errors

The middleware has three layers of defense, in order:

1. **`catchIf`** — catches `Schema.SchemaError` in the error channel with full structured data (JSON Pointer paths via `formatSchemaIssues`). This handles plain `HttpRouter` routes.
2. **`transformResponse`** — rewrites empty-body or JSON-body 4xx responses into `application/problem+json`. This is a fallback for responses that reach the server's default error handler.
3. **`catchDefect`** — catches `SchemaError` instances that `HttpApiBuilder` converted to defects via its internal `Effect.orDie(encodeError(...))` path. Any other defects become a safe 500.

> **Note:** `parseSchemaErrors` (string-based parsing) only activates in the `transformResponse` fallback path for responses already rendered as `application/json`. Most errors are caught earlier with the structured `SchemaIssue` formatter. The string parser is fragile against Effect error-message format changes but won't affect the primary structured paths.

### Middleware execution order

Effect applies global middleware in **reverse registration order**. Place `ProblemJson.middleware()` as the **last** argument in `Layer.mergeAll` so it wraps all other layers:

```ts
// ✅ Correct — middleware runs outermost
Layer.mergeAll(ApiLive, SwaggerLive, ProblemJson.middleware())

// ❌ Wrong — middleware runs before other layers are registered
Layer.mergeAll(ProblemJson.middleware(), ApiLive, SwaggerLive)
```

## Development

The package includes a dev server that exercises all exports with a Todo CRUD API.

```bash
cd packages/effect-problem-json
pnpm dev
```

This starts a server at `http://localhost:3000` with Swagger UI at `/docs` and the OpenAPI spec at `/openapi.json`.

Try it out:

```bash
# List todos
curl http://localhost:3000/todos

# Get a todo (success)
curl http://localhost:3000/todos/1

# Get a todo (404 problem+json via pre-built NotFound)
curl http://localhost:3000/todos/999

# Create a todo
curl -X POST http://localhost:3000/todos \
  -H 'Content-Type: application/json' \
  -d '{"title":"Buy milk"}'

# Trigger a 422 duplicate error (custom makeErrorClass with extension)
curl -X POST http://localhost:3000/todos \
  -H 'Content-Type: application/json' \
  -d '{"title":"Learn Effect v4 HttpApi"}'

# Trigger a schema validation error (400 problem+json)
curl -X POST http://localhost:3000/todos \
  -H 'Content-Type: application/json' \
  -d '{"bad":"field"}'

# Manual validation route (fromSchemaError)
curl -X POST http://localhost:3000/manual-validate \
  -H 'Content-Type: application/json' \
  -d '{"email":"bad","age":-1,"name":""}'
```

## License

MIT
