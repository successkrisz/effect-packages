import { Context, Effect, type Layer, Schema, type SchemaAST } from 'effect'
import type { APIGatewayProxyResult, AwsAPIGatewayProxyEvent, Handler } from './aws.ts'
import type { HandlerContext } from './common.ts'
import { headerNormalizer, normalizeHeaders } from './internal/headerNormalizer.ts'
import { httpStatusMessages } from './internal/http-status-codes.ts'
import { jsonBodyParser } from './internal/jsonBodyParser.ts'
import { makeToHandler } from './makeToHandler.ts'

/**
 * Export types from aws-lambda
 */
export type { APIGatewayProxyResult, AwsAPIGatewayProxyEvent, Handler }

/**
 * Service tag for the API Gateway proxy event.
 *
 * Headers are normalized to lowercase. The body is parsed as JSON when the
 * content-type is `application/json` and base64-decoded when `isBase64Encoded` is true.
 */
export class APIGatewayProxyEvent extends Context.Service<
	APIGatewayProxyEvent,
	AwsAPIGatewayProxyEvent
>()('@effect-lambda/APIGatewayProxyEvent') {}

export const NormalizedAPIGatewayProxyEvent = APIGatewayProxyEvent.useSync((event) =>
	headerNormalizer(event),
)

/**
 * Lazily computed map of normalized (lowercased) headers.
 *
 * Useful when you only need headers without the full normalized event.
 */
export const NormalizedHeaders = APIGatewayProxyEvent.useSync((event) =>
	normalizeHeaders(event.headers),
)

/**
 * Utility to parse the body of an API Gateway event into a type.
 */
export const schemaBodyJson = <S extends Schema.Top>(
	schema: S,
	options?: SchemaAST.ParseOptions | undefined,
) =>
	NormalizedAPIGatewayProxyEvent.pipe(
		Effect.flatMap(jsonBodyParser),
		Effect.map(({ body }) => body as unknown),
		Effect.flatMap((body) => Schema.decodeUnknownEffect(schema)(body, options)),
	)

/**
 * Utility to parse the path parameters of an API Gateway event into a type.
 */
export const schemaPathParams = <S extends Schema.Top>(
	schema: S,
	options?: SchemaAST.ParseOptions | undefined,
) =>
	APIGatewayProxyEvent.useSync((e) => e.pathParameters || {}).pipe(
		Effect.flatMap((pathParameters) => Schema.decodeUnknownEffect(schema)(pathParameters, options)),
	)

/**
 * Utility to parse the query parameters of an API Gateway event into a type.
 */
export const schemaQueryParams = <S extends Schema.Top>(
	schema: S,
	options?: SchemaAST.ParseOptions | undefined,
) =>
	APIGatewayProxyEvent.useSync((e) => e.queryStringParameters || {}).pipe(
		Effect.flatMap((queryStringParameters) =>
			Schema.decodeUnknownEffect(schema)(queryStringParameters, options),
		),
	)

/**
 * Utility to access the path parameters of an API Gateway event into a type.
 *
 * @deprecated Use `schemaPathParams` instead.
 */
export const PathParameters = APIGatewayProxyEvent.useSync((e) => e.pathParameters || {})

/**
 * Utility type can be useful when you are composing with
 * applyMiddleware for example.
 */
export type HandlerEffect<R = never> = Effect.Effect<
	APIGatewayProxyResult,
	never,
	APIGatewayProxyEvent | HandlerContext | R
>

/**
 * Transform a HandlerEffect into an APIGatewayProxyHandler.
 *
 * @param handler HandlerEffect to transform
 * @returns A function that accepts layer and options and returns an APIGatewayProxyHandler
 *
 * @example
 * ```typescript
 * import { toLambdaHandler } from 'effect-lambda/RestApi';
 * import { Context, Effect, Layer } from 'effect';
 *
 * // Handler without dependencies
 * const simpleHandler = Effect.gen(function* () {
 *   const event = yield* APIGatewayProxyEvent;
 *   return {
 *     statusCode: 200,
 *     body: JSON.stringify({ message: "Hello, World!" }),
 *   };
 * });
 *
 * export const handler = toLambdaHandler(simpleHandler)();
 *
 * // Handler with dependencies
 * class DatabaseService extends Context.Service<DatabaseService, { query: (sql: string) => Effect.Effect<any> }>()('@app/database') {}
 *
 * const handlerWithDeps = Effect.gen(function* () {
 *   const event = yield* APIGatewayProxyEvent;
 *   const db = yield* DatabaseService;
 *   const result = yield* db.query('SELECT * FROM users');
 *   return {
 *     statusCode: 200,
 *     body: JSON.stringify({ users: result }),
 *   };
 * });
 *
 * const layer = Layer.succeed(DatabaseService, { query: (sql) => Effect.succeed([]) });
 * export const handlerWithLayer = toLambdaHandler(handlerWithDeps)({ layer });
 * ```
 */
// Overload for when no dependencies are needed (R is never)
// export function toLambdaHandler<E = never>(
//     handler: HandlerEffect<never>,
// ): (params?: {
//     layer?: Layer.Layer<never, E>
//     options?: { readonly memoMap?: Layer.MemoMap }
// }) => Handler<_APIGatewayProxyEvent, APIGatewayProxyResult>

// // Overload for when dependencies are needed (R is not never)
// export function toLambdaHandler<R, E = never>(
//     handler: HandlerEffect<R | APIGatewayProxyEvent | HandlerContext>,
// ): (params: {
//     layer: Layer.Layer<Exclude<R, APIGatewayProxyEvent | HandlerContext>, E>
//     options?: { readonly memoMap?: Layer.MemoMap }
// }) => Handler<_APIGatewayProxyEvent, APIGatewayProxyResult>

// // Overload for when R is inferred as unknown (fallback for pipe usage)
// export function toLambdaHandler<R extends unknown, E = never>(
//     handler: HandlerEffect<R>,
// ): R extends never
//     ? (params?: {
//           layer?: Layer.Layer<never, E>
//           options?: { readonly memoMap?: Layer.MemoMap }
//       }) => Handler<_APIGatewayProxyEvent, APIGatewayProxyResult>
//     : (params: {
//           layer: Layer.Layer<NoInfer<R>, E>
//           options?: { readonly memoMap?: Layer.MemoMap }
//       }) => Handler<_APIGatewayProxyEvent, APIGatewayProxyResult>

// Implementation
export function toLambdaHandler<R, E = never>(
	handler: HandlerEffect<R | APIGatewayProxyEvent | HandlerContext>,
): (params: {
	layer: Layer.Layer<Exclude<R, APIGatewayProxyEvent | HandlerContext>, E>
	options?: { readonly memoMap?: Layer.MemoMap }
}) => Handler<AwsAPIGatewayProxyEvent, APIGatewayProxyResult> {
	const result1 = makeToHandler<typeof APIGatewayProxyEvent, APIGatewayProxyResult>(
		APIGatewayProxyEvent,
	)

	const result2 = result1<R | APIGatewayProxyEvent | HandlerContext, E>(
		handler.pipe(
			Effect.catchDefect(() =>
				Effect.succeed({
					statusCode: 500,
					body: JSON.stringify({ status: 500, title: httpStatusMessages[500] }),
					headers: { 'content-type': 'application/problem+json' },
				}),
			),
		),
	)
	return result2
}
