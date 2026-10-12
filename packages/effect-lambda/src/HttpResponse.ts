/**
 * Response helpers for API Gateway Lambda handlers.
 *
 * The helpers build `{ statusCode, headers, body }` results that work with both
 * REST API (v1) and HTTP API (v2) handlers. JSON bodies are encoded with
 * `Schema`, and error helpers produce RFC 9457 `application/problem+json`
 * bodies with the same shape as `@ballatech/effect-problem-json`.
 *
 * @since 1.0.0
 */
import { Data, Effect, Schema } from 'effect'
import type {
	ClientErrorStatusCode,
	HttpStatusCode,
	httpStatusMessages,
	RedirectionStatusCode,
	ServerErrorStatusCode,
	SuccessStatusCode,
} from './internal/http-status-codes.ts'
import { isJsonContentType } from './internal/jsonBodyParser.ts'
import {
	formatSchemaIssues,
	makeProblemBody,
	problemJsonContentType,
	validationProblemDetail,
} from './internal/problemDetail.ts'
import { type ForbidKeysWithValues, lowercaseKeys } from './utils.ts'

/**
 * Response headers.
 *
 * @since 1.0.0
 * @category models
 */
export type CommonHeaders = { [header: string]: boolean | number | string }

const getContentTypeHeader = (contentType: string | undefined | boolean | number) =>
	typeof contentType === 'string' && isJsonContentType(contentType)
		? contentType
		: 'application/json'

/**
 * Response accepted by both REST API and HTTP API handlers.
 *
 * @since 1.0.0
 * @category models
 */
export type HttpResponse = Readonly<{
	statusCode: HttpStatusCode
	headers?: CommonHeaders
	body: string
	isBase64Encoded?: false
}>

type JsonResponseBaseOptions = {
	statusCode: HttpStatusCode
	body: unknown
	headers?: CommonHeaders
}

type JsonResponseSchema = Schema.Constraint & { readonly EncodingServices: never }

class JsonResponseEncodeError extends Data.TaggedError('JsonResponseEncodeError')<{
	readonly message: string
	readonly cause: unknown
}> {}

/**
 * JSON response with schema-based encoding.
 *
 * When a schema is provided, the body is encoded with
 * `Schema.encodeUnknownEffect(Schema.fromJsonString(schema))`. Otherwise it is
 * serialized as JSON. Encoding failures are defects.
 *
 * @since 1.0.0
 * @category constructors
 */
function jsonResponse<S extends JsonResponseSchema>(opts: {
	statusCode: HttpStatusCode
	body: S['Type']
	schema: S
	headers?: CommonHeaders
}): Effect.Effect<HttpResponse>
function jsonResponse(opts: JsonResponseBaseOptions): Effect.Effect<HttpResponse>
function jsonResponse({
	statusCode,
	body,
	schema,
	headers = {},
}: JsonResponseBaseOptions & { schema?: JsonResponseSchema }): Effect.Effect<HttpResponse> {
	const jsonSchema: Schema.ConstraintEncoder<string, never> =
		schema !== undefined ? Schema.fromJsonString(schema) : Schema.fromJsonString(Schema.Unknown)

	return Schema.encodeUnknownEffect(jsonSchema)(body).pipe(
		Effect.map((encodedBody) => ({
			statusCode,
			body: encodedBody,
			headers: lowercaseKeys(headers),
		})),
		Effect.map((response) => ({
			...response,
			headers: {
				...response.headers,
				'content-type': getContentTypeHeader(response.headers['content-type']),
			},
		})),
		Effect.mapError(
			(error) =>
				new JsonResponseEncodeError({
					message: `[jsonResponse]: Failed to encode body: ${error}`,
					cause: error,
				}),
		),
		Effect.orDie,
	)
}

/**
 * RFC 9457 Problem Details (`application/problem+json`).
 *
 * `type` defaults to `about:blank` and `title` is derived from `status`. Custom
 * members can be added through `extensions`.
 *
 * @since 1.0.0
 * @category models
 */
export type ProblemJson = Readonly<{
	title: (typeof httpStatusMessages)[keyof typeof httpStatusMessages]
	status: HttpStatusCode
	type?: string
	detail?: string
	instance?: string
	extensions?: ForbidKeysWithValues<'title' | 'status' | 'type' | 'detail' | 'instance', unknown>
}>

const problemJsonResponse = (
	statusCode: HttpStatusCode,
	headers?: CommonHeaders,
	options?: Omit<ProblemJson, 'status' | 'title'> & Readonly<{ title?: string }>,
): Effect.Effect<HttpResponse> =>
	jsonResponse({
		statusCode: statusCode,
		headers: { ...headers, 'content-type': problemJsonContentType },
		body: makeProblemBody(statusCode, options),
	})

/**
 * Options for 2xx responses.
 *
 * @since 1.0.0
 * @category options
 */
export type SuccessOptions = Readonly<{
	statusCode: SuccessStatusCode
	headers?: CommonHeaders
}>

/**
 * Options for `201 Created` responses.
 *
 * @since 1.0.0
 * @category options
 */
export type CreatedOptions = Omit<SuccessOptions, 'statusCode'> &
	Readonly<{
		location?: string
	}>

/**
 * Signature of `ok`.
 *
 * @since 1.0.0
 * @category models
 */
export type OkResponse = (
	_: Omit<JsonResponseBaseOptions, 'statusCode'> & {
		statusCode?: Exclude<SuccessStatusCode, 204>
	},
) => Effect.Effect<HttpResponse>

/**
 * Signature of `created`.
 *
 * @since 1.0.0
 * @category models
 */
export type CreatedResponse = (
	_: Omit<JsonResponseBaseOptions, 'statusCode'> & {
		location?: string
	},
) => Effect.Effect<HttpResponse>

/**
 * Signature of `noContent`.
 *
 * @since 1.0.0
 * @category models
 */
export type NoContentResponse = (headers?: CommonHeaders) => HttpResponse

/**
 * 2xx JSON response, defaulting to `200 OK`. `204 No Content` is excluded; use
 * `noContent` instead.
 *
 * @example
 * ```ts
 * const ok = HttpResponse.ok({ statusCode: 200, body: { ok: true } })
 * // => { statusCode: 200, headers: { 'content-type': 'application/json' }, body: '{"ok":true}' }
 * ```
 *
 * @since 1.0.0
 * @category constructors
 */
const ok: OkResponse = ({ statusCode = 200, ...props }) => jsonResponse({ statusCode, ...props })

/**
 * `201 Created` JSON response with an optional `location` header.
 *
 * @since 1.0.0
 * @category constructors
 */
const created: CreatedResponse = ({ location, headers, ...props }) =>
	jsonResponse({
		statusCode: 201,
		headers: location !== undefined && location.length > 0 ? { ...headers, location } : headers,
		...props,
	})

/**
 * `204 No Content` response.
 *
 * @since 1.0.0
 * @category constructors
 */
const noContent: NoContentResponse = (headers) => ({
	statusCode: 204,
	headers: headers && lowercaseKeys(headers),
	body: '',
})

/**
 * Options for 3xx responses.
 *
 * @since 1.0.0
 * @category options
 */
export type RedirectionOptions = Readonly<{
	to: string
	statusCode: RedirectionStatusCode
	headers?: CommonHeaders
}>

/**
 * 3xx response with a `location` header, defaulting to `303 See Other`.
 *
 * Particularly useful for redirecting to signed S3 URLs.
 *
 * @example
 * ```ts
 * const redirect = HttpResponse.redirect({ to: "/new", statusCode: 303, headers: { "X-Req": "1" } })
 * // => { statusCode: 303, headers: { 'location': '/new', 'x-req': '1' } }
 * ```
 *
 * @since 1.0.0
 * @category constructors
 */
const redirect = ({ to, statusCode = 303, headers }: RedirectionOptions) => ({
	statusCode,
	headers: lowercaseKeys({ ...headers, location: to }),
})

/**
 * Options for `clientError`.
 *
 * @since 1.0.0
 * @category options
 */
export type ClientErrorOptions = Readonly<{
	statusCode: ClientErrorStatusCode
	headers?: CommonHeaders
	type?: string
	title?: string
	detail?: string
	instance?: string
	extensions?: Readonly<Record<string, unknown>>
}>

/**
 * Options for `badRequestFromSchemaError`.
 *
 * @since 1.0.0
 * @category options
 */
export type BadRequestFromSchemaOptions = Readonly<{
	/**
	 * Defaults to `about:blank`.
	 */
	type?: string
	/**
	 * Optionally attach the request instance URI/path.
	 */
	instance?: string
	headers?: CommonHeaders
	/**
	 * Defaults to 400.
	 */
	statusCode?: 400 | 422
	/**
	 * Defaults to `The request did not match the expected schema`.
	 */
	detail?: string
}>

/**
 * `400 Bad Request` (or `422`) problem+json response from a `SchemaError`.
 *
 * Each schema issue becomes an entry in `errors` with a `detail` message and,
 * when the issue has a path, a JSON Pointer in `pointer`.
 *
 * @example
 * ```ts
 * const badRequest = HttpResponse.badRequestFromSchemaError(schemaError)
 * // => { statusCode: 400, headers: { 'content-type': 'application/problem+json' }, body: '{"errors":[{"detail":"Expected number, got \"x\"","pointer":"#/n"}],"type":"about:blank","title":"Bad Request","status":400,"detail":"The request did not match the expected schema"}' }
 * ```
 *
 * @since 1.0.0
 * @category constructors
 */
const badRequestFromSchemaError = (
	schemaError: Schema.SchemaError,
	options?: BadRequestFromSchemaOptions,
): Effect.Effect<HttpResponse> =>
	problemJsonResponse(options?.statusCode ?? 400, options?.headers, {
		...options,
		detail: options?.detail ?? validationProblemDetail,
		extensions: { errors: formatSchemaIssues(schemaError) },
	})

/**
 * 4xx problem+json response.
 *
 * @example
 * ```ts
 * const problem = HttpResponse.problem({ status: 404, instance: "/users/123" })
 * // => { statusCode: 404, headers: { 'content-type': 'application/problem+json' }, body: '{"type":"about:blank","title":"Not Found","status":404,"instance":"/users/123"}' }
 * ```
 *
 * @since 1.0.0
 * @category constructors
 */
const problem = (
	problem: Omit<ProblemJson, 'status' | 'title'> & { status: ClientErrorStatusCode },
	headers?: CommonHeaders,
): Effect.Effect<HttpResponse> => problemJsonResponse(problem.status, headers, problem)

/**
 * 4xx problem+json response, defaulting to `400 Bad Request`.
 *
 * @example
 * ```ts
 * const clientError = HttpResponse.clientError({ statusCode: 401, detail: "I don't know you" })
 * // => { statusCode: 401, headers: { 'content-type': 'application/problem+json' }, body: '{"type":"about:blank","title":"Unauthorized","status":401,"detail":"I don't know you"}' }
 * ```
 *
 * @since 1.0.0
 * @category constructors
 */
const clientError = (options?: ClientErrorOptions): Effect.Effect<HttpResponse> =>
	problemJsonResponse(options?.statusCode ?? 400, options?.headers, options)

/**
 * Options for `serverError`.
 *
 * @since 1.0.0
 * @category options
 */
export type ServerErrorOptions = Omit<ProblemJson, 'status' | 'title'> &
	Readonly<{
		statusCode: ServerErrorStatusCode
		headers?: CommonHeaders
	}>

/**
 * 5xx problem+json response, defaulting to `500 Internal Server Error`.
 *
 * @example
 * ```ts
 * const serverError = HttpResponse.serverError({ statusCode: 503, detail: 'Try again later', extensions: { issueRef: "x1234" } })
 * // => { statusCode: 503, headers: { 'content-type': 'application/problem+json' }, body: '{"issueRef":"x1234","type":"about:blank","title":"Service Unavailable","status":503,"detail":"Try again later"}' }
 * ```
 *
 * @since 1.0.0
 * @category constructors
 */
const serverError = (options?: ServerErrorOptions): Effect.Effect<HttpResponse> =>
	problemJsonResponse(options?.statusCode ?? 500, options?.headers, options)

export {
	badRequestFromSchemaError,
	clientError,
	created,
	jsonResponse,
	noContent,
	ok,
	problem,
	redirect,
	serverError,
}
