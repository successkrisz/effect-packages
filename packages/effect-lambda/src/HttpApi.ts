import { Context, Effect, type Layer, Schema, type SchemaAST } from 'effect'
import type {
	APIGatewayProxyHandlerV2,
	AwsAPIGatewayProxyEventV2,
	AwsAPIGatewayProxyResultV2,
} from './aws'
import type { HandlerContext } from './common'
import { headerNormalizer, normalizeHeaders } from './internal/headerNormalizer'
import { jsonBodyParser } from './internal/jsonBodyParser'
import { makeToHandler } from './makeToHandler'

/**
 * Export types from aws-lambda for HTTP API (payload format v2)
 */
export type {
	AwsAPIGatewayProxyEventV2,
	AwsAPIGatewayProxyResultV2,
	APIGatewayProxyHandlerV2 as Handler,
}

/**
 * Context tag for the HTTP API v2 proxy event.
 *
 * - Headers are normalized to lowercase when using `NormalizedAPIGatewayProxyEventV2`
 * - Body is parsed to JSON when `content-type` is JSON using `schemaBodyJson`
 */
export class APIGatewayProxyEventV2 extends Context.Tag('@effect-lambda/APIGatewayProxyEventV2')<
	APIGatewayProxyEventV2,
	AwsAPIGatewayProxyEventV2
>() {}

/** Lazily-normalized (lowercased) headers and preserved rawHeaders on the event. */
export const NormalizedAPIGatewayProxyEventV2 = APIGatewayProxyEventV2.pipe(
	Effect.map(headerNormalizer),
)

/** Lazily-computed map of normalized (lowercased) headers. */
export const NormalizedHeaders = APIGatewayProxyEventV2.pipe(
	Effect.map((event) => normalizeHeaders(event.headers)),
)

/**
 * Utility to parse the JSON body of an HTTP API v2 event into a schema.
 */
export const schemaBodyJson = <A, I, R extends never>(
	schema: Schema.Schema<A, I, R>,
	options?: SchemaAST.ParseOptions | undefined,
) =>
	NormalizedAPIGatewayProxyEventV2.pipe(
		Effect.flatMap(jsonBodyParser),
		Effect.map(({ body }) => body as unknown),
		Effect.flatMap((body) => Schema.decodeUnknownEither(schema, options)(body)),
	)

/**
 * Utility to parse path parameters into a schema.
 */
export const schemaPathParams = <A, I, R extends never>(
	schema: Schema.Schema<A, I, R>,
	options?: SchemaAST.ParseOptions | undefined,
) =>
	APIGatewayProxyEventV2.pipe(
		Effect.map((e) => e.pathParameters || {}),
		Effect.flatMap((params) => Schema.decodeUnknownEither(schema, options)(params)),
	)

/**
 * Utility to parse query parameters into a schema.
 */
export const schemaQueryParams = <A, I, R extends never>(
	schema: Schema.Schema<A, I, R>,
	options?: SchemaAST.ParseOptions | undefined,
) =>
	APIGatewayProxyEventV2.pipe(
		Effect.map((e) => e.queryStringParameters || {}),
		Effect.flatMap((q) => Schema.decodeUnknownEither(schema, options)(q)),
	)

/**
 * Utility type for Effects that produce an HTTP API v2 response and depend on the event/context.
 */
export type HandlerEffect<R = never> = Effect.Effect<
	AwsAPIGatewayProxyResultV2,
	never,
	APIGatewayProxyEventV2 | HandlerContext | R
>

/**
 * Transform a HandlerEffect into an `APIGatewayProxyHandlerV2`.
 *
 * - Adds a 500 fallback on defects
 * - Provide your own dependencies via `layer`
 */
export function toLambdaHandler<R, E = never>(
	handler: HandlerEffect<R | APIGatewayProxyEventV2 | HandlerContext>,
): (params: {
	layer: Layer.Layer<Exclude<R, APIGatewayProxyEventV2 | HandlerContext>, E>
	options?: { readonly memoMap?: Layer.MemoMap }
}) => APIGatewayProxyHandlerV2 {
	const result1 = makeToHandler<typeof APIGatewayProxyEventV2, AwsAPIGatewayProxyResultV2>(
		APIGatewayProxyEventV2,
	)

	const result2 = result1<R | APIGatewayProxyEventV2 | HandlerContext, E>(
		handler.pipe(
			Effect.catchAllDefect(() =>
				Effect.succeed({
					statusCode: 500,
					body: JSON.stringify({ message: 'Internal Server Error' }),
				}),
			),
		),
	)
	return result2
}
