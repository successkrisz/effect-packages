---
"effect-lambda": major
---

Align the public API with Effect v4 naming conventions.

Services use compound PascalCase for acronyms and derived effects use camelCase. The previous names remain as deprecated aliases of the same values, so existing code keeps working:

- `Sqs.SQSEvent`, `Sqs.SQSRecord`, `Sqs.SQSMessageBodies` → `Sqs.SqsEvent`, `Sqs.SqsRecord`, `Sqs.messageBodies`
- `Sns.SNSEvent` → `Sns.SnsEvent`
- `DynamoDb.DynamoDBStreamEvent`, `DynamoDb.DynamoDBRecord`, `DynamoDb.DynamoDBNewImages` → `DynamoDb.DynamoDbStreamEvent`, `DynamoDb.DynamoDbRecord`, `DynamoDb.newImages`
- `RestApi.APIGatewayProxyEvent`, `RestApi.NormalizedAPIGatewayProxyEvent`, `RestApi.NormalizedHeaders` → `RestApi.ApiGatewayProxyEvent`, `RestApi.normalizedEvent`, `RestApi.normalizedHeaders`
- `HttpApi.APIGatewayProxyEventV2`, `HttpApi.NormalizedAPIGatewayProxyEventV2`, `HttpApi.NormalizedHeaders` → `HttpApi.ApiGatewayProxyEventV2`, `HttpApi.normalizedEvent`, `HttpApi.normalizedHeaders`
- `CustomAuthorizer.APIGatewayAuthorizerEvent` → `CustomAuthorizer.ApiGatewayAuthorizerEvent`

Breaking changes:

- Service keys follow the new names, e.g. `effect-lambda/Sqs/SQSEvent` is now `effect-lambda/Sqs/SqsEvent`. This only matters if you look services up by their string key.
- `CustomAuthorizer.UnauthorizedError` now has the `_tag` `"LambdaUnauthorizedError"` (was `"@effect-lambda/UnauthorizedError"`). Update `Effect.catchTag` calls that match on the old string.
- Problem+json helpers (`problem`, `clientError`, `serverError`, `badRequestFromSchemaError`) now emit RFC 9457 bodies: `type` defaults to `"about:blank"`, and `badRequestFromSchemaError` sets a `detail` and reports issues as `errors: [{ detail, pointer }]` with JSON Pointers, matching `@ballatech/effect-problem-json`.
- `RestApi.toLambdaHandler` and `HttpApi.toLambdaHandler` turn defects into a 500 problem+json body with `type`, `title`, `status` and `detail`. The defect is now logged with `Effect.logError` before it is converted.
- `clientError` now uses the `title` option when given; it was previously ignored.
- The titles for 413 and 422 are now `"Content Too Large"` and `"Unprocessable Content"` (RFC 9110).

Other changes:

- `Sqs`, `Sns` and `DynamoDb` re-export `Handler`. Their published `toLambdaHandler` declarations previously referenced the unresolvable `aws-lambda/handler` subpath, which made consumers' handler types `any`.
- `HttpResponse.ok` no longer requires `statusCode`; it defaults to `200` as documented.
- Every public export has `@since` and `@category` JSDoc.
- `package.json` is exported, and packages are published with provenance.
