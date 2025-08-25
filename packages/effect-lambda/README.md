# effect-lambda

[![NPM Version](https://img.shields.io/npm/v/effect-lambda)](https://www.npmjs.com/package/effect-lambda) ![npm](https://img.shields.io/npm/dt/effect-lambda?label=Total%20Downloads) ![npm](https://img.shields.io/npm/dw/effect-lambda?label=Weekly%20Downloads) [![Checked with Biome](https://img.shields.io/badge/Checked_with-Biome-60a5fa?style=flat&logo=biome)](https://biomejs.dev)

Effect friendly wrapper for AWS Lambda functions.

> **Disclaimer:** This library is still in early development stage and the API is likely to change. Feedback is welcome.

## Motivation

Have been using lambda functions as a primary way to build serverless applications for a while now. Since I made the switch from `fp-ts` to `effect`, I wanted to use effects all the way when writing lambda functions, replacing the previous usage of `middy` and `fp-ts`. This library is an attempt to provide a functional way to write lambda functions using the `effect` library. The library is inspired by the `@effect/platform` library and aims to provide a similar experience for writing lambda functions.

## Main Concepts & Caveats

**Pros:**
The main approach of this library to use simple Effects as lambda handlers, allowing access at any point to the event and context allowing some really cool patterns.

- For some of the handlers, this lends itself to more accessible patterns, like an API Gateway handler that provides the payload base64 encoded and stringified in the event body, so being able to abstract away that or normalize headers is quite useful.
- Or take an SQS handler which can operate on individual records in a batch, and provide a utility to handle batch failures.

Take a look at the following example:

```typescript
import { RestApi } from "effect-lambda"
import { Effect, Console, Layer } from "effect"
import * as Schema from 'effect/Schema'

const PayloadSchema = Schema.Struct({
  message: Schema.String,
})

export const _handler = schemaBodyJson(PayloadSchema).pipe(
  Effect.map((payload) => ({
    statusCode: 200,
    body: JSON.stringify({ message: payload.message }),
  })),
  Effect.catchTag("ParseError", () =>
    Effect.succeed({
      statusCode: 400,
      body: "Bad Request",
    }),
  ),
)

export const handler = _handler.pipe(RestApi.toLambdaHandler)({ layer: Layer.empty })

// Or you can add a post processing middleware to the handler just by mapping over the effect
export const handlerWithMiddleware = _handler.pipe(
  Effect.map((response) => ({
    ...response,
    headers: { "Content-Type": "application/json" },
  })),
  RestApi.toLambdaHandler,
)({ layer: Layer.empty })

// Or you can add a pre-processing middleware
export const handlerWithPreMiddleware = RestApi.APIGatewayProxyEvent.pipe(
  Effect.tap((event) => Console.log(`Received event: ${event}`)),
  Effect.flatMap(() => _handler),
  RestApi.toLambdaHandler,
)({ layer: Layer.empty })
```

**Cons:**

- This approach of making the event accessible at any point in the handler requires individual wrappers for each type of event.
- When using a layered architecture, the lambda specific wrapper should be fairly thin, essentially just extracting the domain input for the "use case" layer and map back the domain output to the lambda output.

## Table of Contents

- [effect-lambda](#effect-lambda)
  - [Motivation](#motivation)
  - [Main Concepts \& Caveats](#main-concepts--caveats)
  - [Table of Contents](#table-of-contents)
  - [Installation](#installation)
  - [Usage](#usage)
    - [API Gateway Proxy Handler](#api-gateway-proxy-handler)
    - [HTTP API (payload v2) Handler](#http-api-payload-v2-handler)
    - [SQS Trigger Handler](#sqs-trigger-handler)
    - [SNS Trigger Handler](#sns-trigger-handler)
    - [DynamoDB Stream Event Handler](#dynamodb-stream-event-handler)
    - [Custom Authorizer Handler](#custom-authorizer-handler)
    - [makeToHandler](#maketohandler)
  - [Useful other libraries to use with effect-lambda](#useful-other-libraries-to-use-with-effect-lambda)
  - [TODO list](#todo-list)

## Installation

This library has a peer dependency on `effect`. You can install it via npm or pnpm or any other package manager you prefer.

```bash
# pnpm
pnpm add effect-lambda effect
# npm
npm install effect-lambda effect
```

## Usage

Currently the library provides handlers for the following AWS Lambda triggers:

- API Gateway Proxy Handler
- SNS Handler
- SQS Handler
- DynamoDB Stream Handler

### API Gateway Proxy Handler

```typescript
// handler.ts
import { RestApi } from "effect-lambda"
import { Effect, Layer } from "effect"
import * as Schema from 'effect/Schema'

export const handler = RestApi.toLambdaHandler(
  Effect.succeed({
    statusCode: 200,
    body: JSON.stringify({ message: "Hello, World!" }),
  }),
)({ layer: Layer.empty })

// Or access the payload and path parameters from the event
const PayloadSchema = Schema.Struct({
  message: Schema.String,
})
const PathParamsSchema = Schema.Struct({
  name: Schema.String,
})
export const handler = RestApi.toLambdaHandler(
  RestApi.schemaPathParams(PathParamsSchema).pipe(
    Effect.map(({ name }) => name),
    Effect.bindTo("name"),
    Effect.bind("message", () =>
      RestApi.schemaBodyJson(PayloadSchema).pipe(Effect.map((x) => x.message)),
    ),
    Effect.map(({ name, message }) => ({
      statusCode: 200,
      body: `Hello ${name}, ${message}`,
    })),
    Effect.catchTag("ParseError", () =>
      Effect.succeed({
        statusCode: 400,
        body: "Invalid JSON",
      }),
    ),
  ),
)({ layer: Layer.empty })
```

### HTTP API (payload v2) Handler

```typescript
// handler.ts
import { HttpApi } from "effect-lambda"
import { Effect, Layer } from "effect"
import * as Schema from 'effect/Schema'

// Basic handler
export const handler = HttpApi.toLambdaHandler(
  Effect.succeed({
    statusCode: 200,
    body: JSON.stringify({ message: "Hello, World!" }),
  }),
)({ layer: Layer.empty })

// Access payload and params using schemas
const PayloadSchema = Schema.Struct({
  message: Schema.String,
})
const PathParamsSchema = Schema.Struct({ id: Schema.String })

export const handlerWithSchemas = HttpApi.toLambdaHandler(
  HttpApi.schemaPathParams(PathParamsSchema).pipe(
    Effect.map(({ id }) => id),
    Effect.bindTo("id"),
    Effect.bind("message", () =>
      HttpApi.schemaBodyJson(PayloadSchema).pipe(Effect.map((x) => x.message)),
    ),
    Effect.map(({ id, message }) => ({
      statusCode: 200,
      body: `Hello ${id}, ${message}`,
      // v2 supports setting cookies on the response
      cookies: ["session=abc Secure HttpOnly"],
    })),
    Effect.catchTag("ParseError", () =>
      Effect.succeed({ statusCode: 400, body: "Invalid JSON" }),
    ),
  ),
)({ layer: Layer.empty })
```

You can use [helmet](https://www.npmjs.com/package/helmet) to secure your application using the provided applyMiddleware utility.

```typescript
import { applyMiddleware, RestApi } from "effect-lambda"
import helmet from "helmet"
import { Effect, Layer, pipe } from "effect"

const toHandler = (effect: Parameters<typeof RestApi.toLambdaHandler>[0]) =>
  pipe(effect, Effect.map(applyMiddleware(helmet())), RestApi.toLambdaHandler)

export const handler = Effect.succeed({
  statusCode: 200,
  body: JSON.stringify({ message: "Hello, World!" }),
}).pipe(toHandler)({ layer: Layer.empty })
```

### SQS Trigger Handler

```typescript
import { SQSEvent, toLambdaHandler } from "effect-lambda/Sqs"
import { Effect, Layer } from "effect"
export const handler = toLambdaHandler(
  SQSEvent.pipe(
    Effect.map((event) => {
      // Do something with the event
    }),
  ),
)({ layer: Layer.empty })
```

You can also use a record processor to process each record in a batch individually.

```typescript
import {
  SQSRecord,
  toLambdaHandler,
  recordProcessorAdapter,
} from "effect-lambda/Sqs"
import { Effect, Layer } from "effect"

const processRecord = SQSRecord.pipe(
  Effect.map((record) => {
    // Do something with the record
  }),
)

export const handler = toLambdaHandler(
  processRecord.pipe(recordProcessorAdapter),
)({ layer: Layer.empty })
```

### SNS Trigger Handler

```typescript
import { Sns } from "effect-lambda"
import { Effect, Layer } from "effect"
export const handler = Sns.toLambdaHandler(
  Sns.SNSEvent.pipe(
    Effect.map((event) => {
      // Do something with the event
    }),
  ),
)({ layer: Layer.empty })
```

### DynamoDB Stream Event Handler

```typescript
// handler.ts
import { DynamoDb } from "effect-lambda"
import { Effect, Layer } from "effect"

export const handler = DynamoDb.toLambdaHandler(
  DynamoDb.DynamoDBStreamEvent.pipe(
    Effect.tap((event) =>
      Effect.forEach(event.Records, (record) =>
        Effect.log(`DynamoDB Record: ${record.eventID}`),
      ),
    ),
  ),
)({ layer: Layer.empty })
```

This handler allows you to process DynamoDB stream events in a functional way using the `effect-lambda` library. You can access each record in the stream and apply your business logic accordingly.

### Custom Authorizer Handler

```typescript
import { CustomAuthorizer } from "effect-lambda"
import { Effect } from "effect"

export const handler = CustomAuthorizer.toLambdaHandler(
  Effect.gen(function* () {
    // Access the incoming authorizer event if needed
    // const event = yield* CustomAuthorizer.APIGatewayAuthorizerEvent

    // Build and return an IAM policy
    return {
      principalId: "user-id",
      policyDocument: {
        Version: "2012-10-17",
        Statement: [
          {
            Action: "execute-api:Invoke",
            Effect: "Allow",
            Resource: "*",
          },
        ],
      },
      context: { foo: "bar" },
    }
  })
)
```

### makeToHandler

Helper utility to create a handler from an effect, for other event types.

```typescript

import { makeToHandler } from "effect-lambda"
import { Effect } from "effect"
import { CloudWatchAlarmEvent } from "aws-lambda"

export class Event extends Context.Tag<Event, CloudWatchAlarmEvent>() {}

export const toHandler = makeToHandler<typeof Event, void>(Event)

const program = Event.pipe(
  Effect.map((event) => {
    // Do something with the event
  }),
  Effect.asVoid,
)

export const handler = toHandler(program)({ layer: Layer.empty })
```

## Useful other libraries to use with effect-lambda

- [effect](https://effect.website) - Well you got to have this one to use this library :wink:
  - `@effect/platform-node` - Fully effect native library for network requests, file system, etc.
- [effect-aws](https://github.com/floydspace/effect-aws) - Effect wrapper for common AWS services like S3, DynamoDB, SNS, SQS, etc.

## TODO list

Effect friendly wrapper for AWS Lambdas

- [x] APIGatewayProxyHandler - REST api or HTTP api with payload version 1
- [x] SQS Trigger
- [x] DynamoDB Trigger
- [x] Utility to deal with an array of records and produce a batchItemFailures response upon failures
- [x] Authorizer Trigger
- [x] SNS Trigger
- [x] Change API naming to use namespaces
- [x] Add documentation
- [x] Set up GitHub actions
- [x] Generic makeToHandler function to allow creating ergonomic handlers for different handler types
- [x] Add Lambda runtime to allow graceful shutdown and clearing up of resources
- [x] APIGatewayProxyHandlerV2 - HTTP api with payload version 2
- [ ] S3 Put Event Handler
- [ ] S3 Delete Event Handler
- [ ] SES Trigger
- [ ] EventBridge Trigger
- [ ] Add content negotiation for API Gateway Handlers
