/**
 * Adapters for API Gateway REST API (and HTTP API payload v1) Lambda functions.
 *
 * The incoming proxy event is provided to the program through the
 * `ApiGatewayProxyEvent` service. Helpers decode the JSON body, path parameters
 * and query parameters with `Schema`.
 *
 * @since 1.0.0
 */
import { Context, Effect, type Layer, Schema, type SchemaAST } from 'effect'
import type { APIGatewayProxyResult, AwsAPIGatewayProxyEvent, Handler } from './aws.ts'
import type { HandlerContext } from './common.ts'
import { headerNormalizer, normalizeHeaders } from './internal/headerNormalizer.ts'
import { jsonBodyParser } from './internal/jsonBodyParser.ts'
import { makeInternalServerErrorResponse } from './internal/problemDetail.ts'
import { makeToHandler } from './makeToHandler.ts'

export type {
	/**
	 * @since 1.0.0
	 * @category models
	 */
	APIGatewayProxyResult,
	/**
	 * @since 1.0.0
	 * @category models
	 */
	AwsAPIGatewayProxyEvent,
	/**
	 * @since 1.0.0
	 * @category models
	 */
	Handler,
}

/**
 * Service providing the incoming API Gateway proxy event, as received from AWS.
 *
 * @since 1.0.0
 * @category services
 */
export class ApiGatewayProxyEvent extends Context.Service<
	ApiGatewayProxyEvent,
	AwsAPIGatewayProxyEvent
>()('effect-lambda/RestApi/ApiGatewayProxyEvent') {}

/**
 * The proxy event with lowercased `headers`. The original headers are kept in
 * `rawHeaders`.
 *
 * @since 1.0.0
 * @category accessors
 */
export const normalizedEvent = ApiGatewayProxyEvent.useSync((event) => headerNormalizer(event))

/**
 * The request headers with lowercased keys.
 *
 * @since 1.0.0
 * @category accessors
 */
export const normalizedHeaders = ApiGatewayProxyEvent.useSync((event) =>
	normalizeHeaders(event.headers),
)

/**
 * Decode the JSON body of the event with a schema.
 *
 * The body is base64-decoded when `isBase64Encoded` is true, and only parsed
 * as JSON when the `content-type` is a JSON media type.
 *
 * @since 1.0.0
 * @category decoding
 */
export const schemaBodyJson = <S extends Schema.Top>(
	schema: S,
	options?: SchemaAST.ParseOptions | undefined,
) =>
	normalizedEvent.pipe(
		Effect.flatMap(jsonBodyParser),
		Effect.map(({ body }) => body as unknown),
		Effect.flatMap((body) => Schema.decodeUnknownEffect(schema)(body, options)),
	)

/**
 * Decode the path parameters of the event with a schema.
 *
 * @since 1.0.0
 * @category decoding
 */
export const schemaPathParams = <S extends Schema.Top>(
	schema: S,
	options?: SchemaAST.ParseOptions | undefined,
) =>
	ApiGatewayProxyEvent.useSync((e) => e.pathParameters || {}).pipe(
		Effect.flatMap((pathParameters) => Schema.decodeEffect(schema)(pathParameters, options)),
	)

/**
 * Decode the query string parameters of the event with a schema.
 *
 * @since 1.0.0
 * @category decoding
 */
export const schemaQueryParams = <S extends Schema.Top>(
	schema: S,
	options?: SchemaAST.ParseOptions | undefined,
) =>
	ApiGatewayProxyEvent.useSync((e) => e.queryStringParameters || {}).pipe(
		Effect.flatMap((queryStringParameters) =>
			Schema.decodeEffect(schema)(queryStringParameters, options),
		),
	)

/**
 * The raw path parameters of the event.
 *
 * @deprecated Use `schemaPathParams` instead.
 * @since 1.0.0
 * @category accessors
 */
export const PathParameters = ApiGatewayProxyEvent.useSync((e) => e.pathParameters || {})

/**
 * An effect that produces a REST API response and may depend on the event, the
 * Lambda context and `R`. Useful when composing handlers, for example with
 * `applyMiddleware`.
 *
 * @since 1.0.0
 * @category models
 */
export type HandlerEffect<R = never> = Effect.Effect<
	APIGatewayProxyResult,
	never,
	ApiGatewayProxyEvent | HandlerContext | R
>

/**
 * Convert a `HandlerEffect` into an API Gateway proxy handler.
 *
 * Defects are turned into a `500` `application/problem+json` response. Services required by the effect other than the event and the
 * Lambda context are provided through `layer`.
 *
 * @example
 * ```ts
 * import { RestApi } from 'effect-lambda'
 * import { Context, Effect, Layer } from 'effect'
 *
 * export const handler = RestApi.toLambdaHandler(
 *   RestApi.ApiGatewayProxyEvent.use((event) =>
 *     Effect.succeed({ statusCode: 200, body: event.path }),
 *   ),
 * )({ layer: Layer.empty })
 *
 * class Database extends Context.Service<
 *   Database,
 *   { readonly query: (sql: string) => Effect.Effect<Array<unknown>> }
 * >()('app/Database') {}
 *
 * export const handlerWithLayer = RestApi.toLambdaHandler(
 *   Database.use((db) => db.query('select 1')).pipe(
 *     Effect.map((rows) => ({ statusCode: 200, body: JSON.stringify(rows) })),
 *   ),
 * )({ layer: Layer.succeed(Database, { query: () => Effect.succeed([]) }) })
 * ```
 *
 * @since 1.0.0
 * @category converting
 */
export function toLambdaHandler<R, E = never>(
	handler: HandlerEffect<R | ApiGatewayProxyEvent | HandlerContext>,
): (params: {
	layer: Layer.Layer<Exclude<R, ApiGatewayProxyEvent | HandlerContext>, E>
	options?: { readonly memoMap?: Layer.MemoMap }
}) => Handler<AwsAPIGatewayProxyEvent, APIGatewayProxyResult> {
	const toHandler = makeToHandler<typeof ApiGatewayProxyEvent, APIGatewayProxyResult>(
		ApiGatewayProxyEvent,
	)

	return toHandler<R | ApiGatewayProxyEvent | HandlerContext, E>(
		handler.pipe(
			Effect.tapDefect(Effect.logError),
			Effect.catchDefect(() => Effect.sync(makeInternalServerErrorResponse)),
		),
	)
}

/**
 * @deprecated Use `ApiGatewayProxyEvent`.
 * @since 1.0.0
 * @category services
 */
export const APIGatewayProxyEvent = ApiGatewayProxyEvent
/**
 * @deprecated Use `ApiGatewayProxyEvent`.
 * @since 1.0.0
 * @category services
 */
export type APIGatewayProxyEvent = ApiGatewayProxyEvent

/**
 * @deprecated Use `normalizedEvent`.
 * @since 1.0.0
 * @category accessors
 */
export const NormalizedAPIGatewayProxyEvent = normalizedEvent

/**
 * @deprecated Use `normalizedHeaders`.
 * @since 1.0.0
 * @category accessors
 */
export const NormalizedHeaders = normalizedHeaders
