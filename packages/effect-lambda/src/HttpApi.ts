import { Context, Effect, type Layer, Schema, type SchemaAST } from 'effect'
import type {
	APIGatewayProxyHandlerV2,
	AwsAPIGatewayProxyEventV2,
	AwsAPIGatewayProxyResultV2,
} from './aws.ts'
import type { HandlerContext } from './common.ts'
import { headerNormalizer, normalizeHeaders } from './internal/headerNormalizer.ts'
import { httpStatusMessages } from './internal/http-status-codes.ts'
import { jsonBodyParser } from './internal/jsonBodyParser.ts'
import { makeToHandler } from './makeToHandler.ts'

/**
 * Export types from aws-lambda for HTTP API (payload format v2)
 */
export type {
	APIGatewayProxyHandlerV2 as Handler,
	AwsAPIGatewayProxyEventV2,
	AwsAPIGatewayProxyResultV2,
}

/**
 * Context tag for the HTTP API v2 proxy event.
 *
 * - Headers are normalized to lowercase when using `NormalizedAPIGatewayProxyEventV2`
 * - Body is parsed to JSON when `content-type` is JSON using `schemaBodyJson`
 */
export class APIGatewayProxyEventV2 extends Context.Service<
	APIGatewayProxyEventV2,
	AwsAPIGatewayProxyEventV2
>()('effect-lambda/HttpApi/APIGatewayProxyEventV2') {}

/** Lazily-normalized (lowercased) headers and preserved rawHeaders on the event. */
export const NormalizedAPIGatewayProxyEventV2 = APIGatewayProxyEventV2.useSync((event) =>
	headerNormalizer(event),
)

/** Lazily-computed map of normalized (lowercased) headers. */
export const NormalizedHeaders = APIGatewayProxyEventV2.useSync((event) =>
	normalizeHeaders(event.headers),
)
/**
 * Utility to parse the JSON body of an HTTP API v2 event into a schema.
 */
export const schemaBodyJson = <S extends Schema.Top>(
	schema: S,
	options?: SchemaAST.ParseOptions | undefined,
) =>
	NormalizedAPIGatewayProxyEventV2.pipe(
		Effect.flatMap(jsonBodyParser),
		Effect.map(({ body }) => body as unknown),
		Effect.flatMap((body) => Schema.decodeUnknownEffect(schema)(body, options)),
	)

/**
 * Utility to parse path parameters into a schema.
 */
export const schemaPathParams = <S extends Schema.Top>(
	schema: S,
	options?: SchemaAST.ParseOptions | undefined,
) =>
	APIGatewayProxyEventV2.useSync((e) => e.pathParameters || {}).pipe(
		Effect.flatMap((params) => Schema.decodeEffect(schema)(params, options)),
	)
/**
 * Utility to parse query parameters into a schema.
 */
export const schemaQueryParams = <S extends Schema.Top>(
	schema: S,
	options?: SchemaAST.ParseOptions | undefined,
) =>
	APIGatewayProxyEventV2.useSync((e) => e.queryStringParameters || {}).pipe(
		Effect.map((e) => e.queryStringParameters || {}),
		Effect.flatMap((q) => Schema.decodeEffect(schema)(q, options)),
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
