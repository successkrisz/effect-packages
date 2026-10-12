/**
 * Adapters for API Gateway HTTP API (payload format v2) Lambda functions.
 *
 * The incoming proxy event is provided to the program through the
 * `ApiGatewayProxyEventV2` service. Helpers decode the JSON body, path
 * parameters and query parameters with `Schema`.
 *
 * @since 1.0.0
 */
import { Context, Effect, type Layer, Schema, type SchemaAST } from 'effect'
import type {
	APIGatewayProxyHandlerV2,
	AwsAPIGatewayProxyEventV2,
	AwsAPIGatewayProxyResultV2,
} from './aws.ts'
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
	APIGatewayProxyHandlerV2 as Handler,
	/**
	 * @since 1.0.0
	 * @category models
	 */
	AwsAPIGatewayProxyEventV2,
	/**
	 * @since 1.0.0
	 * @category models
	 */
	AwsAPIGatewayProxyResultV2,
}

/**
 * Service providing the incoming HTTP API v2 proxy event, as received from AWS.
 *
 * @since 1.0.0
 * @category services
 */
export class ApiGatewayProxyEventV2 extends Context.Service<
	ApiGatewayProxyEventV2,
	AwsAPIGatewayProxyEventV2
>()('effect-lambda/HttpApi/ApiGatewayProxyEventV2') {}

/**
 * The proxy event with lowercased `headers`. The original headers are kept in
 * `rawHeaders`.
 *
 * @since 1.0.0
 * @category accessors
 */
export const normalizedEvent = ApiGatewayProxyEventV2.useSync((event) => headerNormalizer(event))

/**
 * The request headers with lowercased keys.
 *
 * @since 1.0.0
 * @category accessors
 */
export const normalizedHeaders = ApiGatewayProxyEventV2.useSync((event) =>
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
	ApiGatewayProxyEventV2.useSync((e) => e.pathParameters || {}).pipe(
		Effect.flatMap((params) => Schema.decodeEffect(schema)(params, options)),
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
	ApiGatewayProxyEventV2.useSync((e) => e.queryStringParameters || {}).pipe(
		Effect.flatMap((queryStringParameters) =>
			Schema.decodeEffect(schema)(queryStringParameters, options),
		),
	)

/**
 * An effect that produces an HTTP API v2 response and may depend on the event,
 * the Lambda context and `R`.
 *
 * @since 1.0.0
 * @category models
 */
export type HandlerEffect<R = never> = Effect.Effect<
	AwsAPIGatewayProxyResultV2,
	never,
	ApiGatewayProxyEventV2 | HandlerContext | R
>

/**
 * Convert a `HandlerEffect` into an `APIGatewayProxyHandlerV2`.
 *
 * Defects are turned into a `500` `application/problem+json` response.
 * Services required by the effect other than the event and the Lambda context
 * are provided through `layer`.
 *
 * @example
 * ```ts
 * import { HttpApi } from 'effect-lambda'
 * import { Effect, Layer } from 'effect'
 *
 * export const handler = HttpApi.toLambdaHandler(
 *   HttpApi.ApiGatewayProxyEventV2.use((event) =>
 *     Effect.succeed({ statusCode: 200, body: event.rawPath }),
 *   ),
 * )({ layer: Layer.empty })
 * ```
 *
 * @since 1.0.0
 * @category converting
 */
export function toLambdaHandler<R, E = never>(
	handler: HandlerEffect<R | ApiGatewayProxyEventV2 | HandlerContext>,
): (params: {
	layer: Layer.Layer<Exclude<R, ApiGatewayProxyEventV2 | HandlerContext>, E>
	options?: { readonly memoMap?: Layer.MemoMap }
}) => APIGatewayProxyHandlerV2 {
	const toHandler = makeToHandler<typeof ApiGatewayProxyEventV2, AwsAPIGatewayProxyResultV2>(
		ApiGatewayProxyEventV2,
	)

	return toHandler<R | ApiGatewayProxyEventV2 | HandlerContext, E>(
		handler.pipe(
			Effect.tapDefect(Effect.logError),
			Effect.catchDefect(() => Effect.sync(makeInternalServerErrorResponse)),
		),
	)
}

/**
 * @deprecated Use `ApiGatewayProxyEventV2`.
 * @since 1.0.0
 * @category services
 */
export const APIGatewayProxyEventV2 = ApiGatewayProxyEventV2
/**
 * @deprecated Use `ApiGatewayProxyEventV2`.
 * @since 1.0.0
 * @category services
 */
export type APIGatewayProxyEventV2 = ApiGatewayProxyEventV2

/**
 * @deprecated Use `normalizedEvent`.
 * @since 1.0.0
 * @category accessors
 */
export const NormalizedAPIGatewayProxyEventV2 = normalizedEvent

/**
 * @deprecated Use `normalizedHeaders`.
 * @since 1.0.0
 * @category accessors
 */
export const NormalizedHeaders = normalizedHeaders
