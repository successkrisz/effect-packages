import { Effect, Schema, SchemaIssue } from 'effect'
import {
	type ClientErrorStatusCode,
	type HttpStatusCode,
	httpStatusMessages,
	type RedirectionStatusCode,
	type ServerErrorStatusCode,
	type SuccessStatusCode,
} from './internal/http-status-codes.ts'
import { isJsonContentType } from './internal/jsonBodyParser.ts'
import { type ForbidKeysWithValues, lowercaseKeys } from './utils.ts'

export type CommonHeaders = { [header: string]: boolean | number | string }

const getContentTypeHeader = (contentType: string | undefined | boolean | number) =>
	typeof contentType === 'string' && isJsonContentType(contentType)
		? contentType
		: 'application/json'

/**
 * Narrow AWS Gateway v2-style result (works with HTTP API and REST API)
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

/**
 * JSON HTTP Response with schema-based encoding.
 *
 * When a schema is provided, encodes the body via `Schema.encodeEffect(Schema.fromJsonString(schema))`.
 * Otherwise falls back to `JSON.stringify`.
 */
function jsonResponse<S extends Schema.Top>(opts: {
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
}: JsonResponseBaseOptions & { schema?: Schema.Any }): Effect.Effect<HttpResponse> {
	return Schema.encodeEffect(schema ? Schema.fromJsonString(schema) : Schema.UnknownFromJsonString)(
		body,
	).pipe(
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
			(error) => new Error(`[jsonResponse]: Failed to encode body: ${error}`, { cause: error }),
		),
		Effect.orDie,
	)
}

/**
 * RFC 7807 Problem Details (problem+json).
 * You can extend with custom fields via `extensions`.
 */
export type ProblemJson = Readonly<{
	title: (typeof httpStatusMessages)[keyof typeof httpStatusMessages]
	status: HttpStatusCode
	type?: string
	detail?: string
	instance?: string
	extensions?: ForbidKeysWithValues<'title' | 'status' | 'type' | 'detail' | 'instance', unknown>
}>

// Internal helpers for problem+json -------------------------------
const buildProblemBody = (
	statusCode: HttpStatusCode,
	options?: Omit<ProblemJson, 'status' | 'title'>,
) => ({
	...options?.extensions,
	status: statusCode,
	title: httpStatusMessages[statusCode],
	type: options?.type,
	instance: options?.instance,
	detail: options?.detail,
})

const problemJsonResponse = (
	statusCode: HttpStatusCode,
	headers?: CommonHeaders,
	options?: Omit<ProblemJson, 'status' | 'title'>,
): Effect.Effect<HttpResponse> =>
	jsonResponse({
		statusCode: statusCode,
		headers: { ...headers, 'content-type': 'application/problem+json' },
		body: buildProblemBody(statusCode, options),
	})
// -----------------------------------------------------------------

// -- 2xx Success responses --
export type SuccessOptions = Readonly<{
	statusCode: SuccessStatusCode
	headers?: CommonHeaders
}>

export type CreatedOptions = Omit<SuccessOptions, 'statusCode'> &
	Readonly<{
		location?: string
	}>

export type OkResponse = (
	_: Omit<JsonResponseBaseOptions, 'statusCode'> & {
		statusCode: Exclude<SuccessStatusCode, 204>
	},
) => Effect.Effect<HttpResponse>

export type CreatedResponse = (
	_: Omit<JsonResponseBaseOptions, 'statusCode'> & {
		location?: string
	},
) => Effect.Effect<HttpResponse>

export type NoContentResponse = (headers?: CommonHeaders) => HttpResponse

/**
 * 2xx response defaulting to 200 OK
 *
 * Excludes 204 No Content
 *
 * @example
 * ```ts
 * const ok = HttpResponse.ok({ statusCode: 200, body: { ok: true } })
 * // => { statusCode: 200, headers: { 'content-type': 'application/json' }, body: '{"ok":true}' }
 * ```
 */
const ok: OkResponse = ({ statusCode = 200, ...props }) => jsonResponse({ statusCode, ...props })

/**
 * 201 Created response with optional location header
 */
const created: CreatedResponse = ({ location, headers, ...props }) =>
	jsonResponse({
		statusCode: 201,
		headers: location ? { ...headers, location } : headers,
		...props,
	})

/**
 * 204 No Content response
 */
const noContent: NoContentResponse = (headers) => ({
	statusCode: 204,
	headers: headers && lowercaseKeys(headers),
	body: '',
})

// -- 3xx Redirection responses --
export type RedirectionOptions = Readonly<{
	to: string
	statusCode: RedirectionStatusCode
	headers?: CommonHeaders
}>

/**
 * 3xx response defaulting to 303 See Other
 *
 * Particularly useful for getting results from s3 via signed S3 URLs
 *
 * @example
 * ```ts
 * const redirect = HttpResponse.redirect({ to: "/new", statusCode: 303, headers: { "X-Req": "1" } })
 * // => { statusCode: 303, headers: { 'location': '/new', 'x-req': '1' } }
 * ```
 */
const redirect = ({ to, statusCode = 303, headers }: RedirectionOptions) => ({
	statusCode,
	headers: lowercaseKeys({ ...headers, location: to }),
})

// -- 4xx Client Error responses --

export type ClientErrorOptions = Readonly<{
	statusCode: ClientErrorStatusCode
	headers?: CommonHeaders
	type?: string // default: "about:blank" or your org’s URI
	title?: string // short summary; default derived from status
	detail?: string
	instance?: string
	extensions?: Readonly<Record<string, unknown>>
}>

export type BadRequestFromSchemaOptions = Readonly<{
	/**
	 * Defaults to "https://example.com/problems/validation-error".
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
	 * Optionally attach a detail message.
	 */
	detail?: string
}>

const standardSchemaV1Formatter = SchemaIssue.makeFormatterStandardSchemaV1()

const badRequestErrorFormatter = (error: Schema.SchemaError) =>
	standardSchemaV1Formatter(error.issue).issues.map(({ path, message }) =>
		path?.length ? { path, message } : { message },
	)

/**
 * 400 Bad Request response from SchemaError
 *
 * @example
 * ```ts
 * const badRequest = HttpResponse.badRequestFromSchemaError(schemaError, {
 *   statusCode: 400,
 *   type: "https://example.com/problems/validation-error",
 * })
 * // => { statusCode: 400, headers: { 'content-type': 'application/problem+json' }, body: '{"status":400,"title":"Bad Request","errors":[{"message":"Invalid value"}]}' }
 * ```
 */
const badRequestFromSchemaError = (
	schemaError: Schema.SchemaError,
	options?: BadRequestFromSchemaOptions,
): Effect.Effect<HttpResponse> =>
	problemJsonResponse(options?.statusCode ?? 400, options?.headers, {
		...options,
		extensions: { errors: badRequestErrorFormatter(schemaError) },
	})

/**
 * 4xx client error response
 *
 * @example
 * ```ts
 * const problem = HttpResponse.problem({ status: 404, instance: "/users/123" })
 * // => { statusCode: 404, headers: { 'content-type': 'application/problem+json' }, body: '{"status":404,"title":"Not Found","instance":"/users/123"}' }
 * ```
 */
const problem = (
	problem: Omit<ProblemJson, 'status' | 'title'> & { status: ClientErrorStatusCode },
	headers?: CommonHeaders,
): Effect.Effect<HttpResponse> => problemJsonResponse(problem.status, headers, problem)

/**
 * Generic 4xx client error builder as problem+json.
 * Enforces 4xx status range.
 *
 * @example
 * ```ts
 * const clientError = HttpResponse.clientError({ statusCode: 401, detail: "I don't know you" })
 * // => { statusCode: 401, headers: { 'content-type': 'application/problem+json' }, body: '{"status":401,"title":"Unauthorized","detail":"I don't know you"}' }
 * ```
 */
const clientError = (options?: ClientErrorOptions): Effect.Effect<HttpResponse> =>
	problemJsonResponse(options?.statusCode ?? 400, options?.headers, options)

// -- 5xx Server Error responses --
export type ServerErrorOptions = Omit<ProblemJson, 'status' | 'title'> &
	Readonly<{
		statusCode: ServerErrorStatusCode
		headers?: CommonHeaders
	}>

/**
 * 5xx server error response
 *
 * @example
 * ```ts
 * const serverError = HttpResponse.serverError({ statusCode: 500, detail: 'Something went wrong, please try again later or contact support if the problem persists', extensions: { issueRef: "x1234" } })
 * // => { statusCode: 500, headers: { 'content-type': 'application/problem+json' }, body: '{"status":500,"title":"Internal Server Error","detail":"Something went wrong, please try again later or contact support if the problem persists","issueRef":"x1234"}' }
 * ```
 */
const serverError = (options?: ServerErrorOptions): Effect.Effect<HttpResponse> =>
	problemJsonResponse(options?.statusCode ?? 500, options?.headers, options)

export {
	// -- 2xx Success responses --
	ok,
	created,
	noContent,
	// -- 3xx Redirection responses --
	redirect,
	// -- 4xx Client Error responses --
	badRequestFromSchemaError,
	problem,
	clientError,
	// -- 5xx Server Error responses --
	serverError,
	// -- Common --
	jsonResponse,
}
