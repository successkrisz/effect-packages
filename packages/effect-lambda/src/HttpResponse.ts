import { Effect, ParseResult } from 'effect'
import type { ParseError } from 'effect/ParseResult'
import * as S from 'effect/Schema'
import {
	type ClientErrorStatusCode,
	type HttpStatusCode,
	httpStatusMessages,
	type RedirectionStatusCode,
	type ServerErrorStatusCode,
	type SuccessStatusCode,
} from './internal/http-status-codes'
import { isJsonContentType } from './internal/jsonBodyParser'
import { type ForbidKeysWithValues, lowercaseKeys } from './utils'

export type CommonHeaders = { [header: string]: boolean | number | string }

const getContentTypeHeader = (contentType: string | undefined | boolean | number) =>
	typeof contentType === 'string' && isJsonContentType(contentType)
		? contentType
		: 'application/json'

/**
 * JSON HTTP Response with schema-based encoding
 */
const jsonResponse = <T = unknown>({
	statusCode,
	body,
	schema = S.Any,
	headers = {},
}: {
	statusCode: HttpStatusCode
	body: T
	// biome-ignore lint/suspicious/noExplicitAny: accept arbitrary schema
	schema?: S.Schema<T, any>
	headers?: CommonHeaders
}) =>
	S.encode(S.parseJson(schema))(body).pipe(
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
		Effect.orDieWith(
			(error) => new Error(`[jsonResponse]: Failed to encode body: ${error}`, { cause: error }),
		),
	)

/**
 * Narrow AWS Gateway v2-style result (works with HTTP API and REST API)
 */
export type HttpResponse = Readonly<{
	statusCode: HttpStatusCode
	headers?: CommonHeaders
	body?: string
	isBase64Encoded?: false
}>

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

type OkResponse = (
	_: Omit<Parameters<typeof jsonResponse>[0], 'statusCode'> & {
		statusCode: Exclude<SuccessStatusCode, 204>
	},
) => Effect.Effect<HttpResponse>

type CreatedResponse = (
	_: Omit<Parameters<typeof jsonResponse>[0], 'statusCode'> & {
		location?: string
	},
) => Effect.Effect<HttpResponse>

type NoContentResponse = (headers?: CommonHeaders) => HttpResponse

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

export type BadRequestFromParseOptions = Readonly<{
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

const badRequestErrorFormatter = (error: ParseResult.ParseError) =>
	ParseResult.ArrayFormatter.formatError(error).pipe(
		Effect.map((arr) =>
			arr.map(({ _tag: _, path, message }) => (path.length ? { path, message } : { message })),
		),
	)

/**
 * 400 Bad Request response from ParseError
 *
 * @example
 * ```ts
 * const badRequest = HttpResponse.badRequestFromParseError(parseError, {
 *   statusCode: 400,
 *   type: "https://example.com/problems/validation-error",
 * })
 * // => { statusCode: 400, headers: { 'content-type': 'application/problem+json' }, body: '{"status":400,"title":"Bad Request","errors":[{"message":"Invalid value"}]}' }
 * ```
 */
const badRequestFromParseError = (
	parseError: ParseError,
	options?: BadRequestFromParseOptions,
): Effect.Effect<HttpResponse> =>
	badRequestErrorFormatter(parseError).pipe(
		Effect.flatMap((errors) =>
			problemJsonResponse(options?.statusCode ?? 400, options?.headers, {
				...options,
				extensions: { errors },
			}),
		),
	)

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
	badRequestFromParseError,
	problem,
	clientError,
	// -- 5xx Server Error responses --
	serverError,
	// -- Common --
	jsonResponse,
}
