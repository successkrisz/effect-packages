/**
 * Reusable building blocks for RFC 9457 (Problem Details for HTTP APIs)
 * with Effect HttpApi.
 *
 * @see https://www.rfc-editor.org/rfc/rfc9457.html
 */
import { Effect, Option, pipe, Schema, SchemaIssue } from 'effect'
import type { HttpServerResponse as HttpServerResponseType } from 'effect/unstable/http'
import { HttpRouter, HttpServerResponse } from 'effect/unstable/http'
import { HttpApiSchema } from 'effect/unstable/httpapi'

// ---------------------------------------------------------------------------
// Status titles (RFC 9110 reason phrases) — all 4xx and 5xx codes
// ---------------------------------------------------------------------------

export const statusTitles = {
	400: 'Bad Request',
	401: 'Unauthorized',
	402: 'Payment Required',
	403: 'Forbidden',
	404: 'Not Found',
	405: 'Method Not Allowed',
	406: 'Not Acceptable',
	407: 'Proxy Authentication Required',
	408: 'Request Timeout',
	409: 'Conflict',
	410: 'Gone',
	411: 'Length Required',
	412: 'Precondition Failed',
	413: 'Content Too Large',
	414: 'URI Too Long',
	415: 'Unsupported Media Type',
	416: 'Range Not Satisfiable',
	417: 'Expectation Failed',
	418: "I'm a Teapot",
	421: 'Misdirected Request',
	422: 'Unprocessable Content',
	423: 'Locked',
	424: 'Failed Dependency',
	425: 'Too Early',
	426: 'Upgrade Required',
	428: 'Precondition Required',
	429: 'Too Many Requests',
	431: 'Request Header Fields Too Large',
	451: 'Unavailable For Legal Reasons',
	500: 'Internal Server Error',
	501: 'Not Implemented',
	502: 'Bad Gateway',
	503: 'Service Unavailable',
	504: 'Gateway Timeout',
	505: 'HTTP Version Not Supported',
	506: 'Variant Also Negotiates',
	507: 'Insufficient Storage',
	508: 'Loop Detected',
	510: 'Not Extended',
	511: 'Network Authentication Required',
} as const

export type StatusCode = keyof typeof statusTitles

// ---------------------------------------------------------------------------
// Extensions — flat-spread fields that forbid collisions with base keys
// ---------------------------------------------------------------------------

type ProblemBaseKeys = 'type' | 'title' | 'status' | 'detail' | 'instance'
export type Extensions = { [P in ProblemBaseKeys]?: never } & Record<string, unknown>

// ---------------------------------------------------------------------------
// errorFields — RFC 9457 schema fields for a given HTTP status
// ---------------------------------------------------------------------------

export function errorFields<S extends StatusCode>(status: S) {
	return {
		type: Schema.String.pipe(Schema.withConstructorDefault(() => Option.some('about:blank'))),
		title: Schema.String.pipe(
			Schema.withConstructorDefault(() => Option.some(statusTitles[status] as string)),
		),
		status: Schema.Literal(status).pipe(
			Schema.withConstructorDefault(() => Option.some(status as S)),
		),
		detail: Schema.String,
		instance: Schema.optional(Schema.String),
	}
}

// ---------------------------------------------------------------------------
// asProblemJson — set content type to application/problem+json
// ---------------------------------------------------------------------------

export function asProblemJson<S extends Schema.Top>(schema: S): S['~rebuild.out'] {
	return schema.pipe(HttpApiSchema.asJson({ contentType: 'application/problem+json' }))
}

// ---------------------------------------------------------------------------
// makeErrorClass — one-call helper for Schema.ErrorClass + asProblemJson
// ---------------------------------------------------------------------------

type SchemaToType<S> = S extends Schema.Schema<infer A> ? A : never

type MakeInput<S extends StatusCode, F extends Schema.Struct.Fields> = {
	readonly detail: string
	readonly type?: string
	readonly title?: string
	readonly status?: S
	readonly instance?: string
} & { readonly [K in keyof F]: SchemaToType<F[K]> }

// biome-ignore lint/complexity/noBannedTypes: {} means "no additional fields" for the extensions default
export function makeErrorClass<S extends StatusCode, F extends Schema.Struct.Fields = {}>(
	tag: string,
	status: S,
	extensions?: F,
) {
	const allFields = { ...errorFields(status), ...extensions }

	class ProblemError extends Schema.ErrorClass<ProblemError>(tag)(allFields, {
		httpApiStatus: status,
	}) {}

	const problem = asProblemJson(ProblemError)

	return {
		Error: ProblemError,
		problem,
		make: (input: MakeInput<S, F>) =>
			new ProblemError(input as unknown as ConstructorParameters<typeof ProblemError>[0]),
	}
}

// ---------------------------------------------------------------------------
// makeResponse — create an ad-hoc problem+json HttpServerResponse
// ---------------------------------------------------------------------------

export function makeResponse(
	status: StatusCode,
	detail: string,
	options?: {
		readonly type?: string
		readonly instance?: string
		readonly extensions?: Extensions
	},
): HttpServerResponseType.HttpServerResponse {
	return HttpServerResponse.jsonUnsafe(
		{
			...options?.extensions,
			type: options?.type ?? 'about:blank',
			title: statusTitles[status],
			status,
			detail,
			instance: options?.instance,
		},
		{ status, contentType: 'application/problem+json' },
	)
}

// ---------------------------------------------------------------------------
// Shared types & schemas for validation errors
//
// The `pointer` field uses JSON Pointer syntax (RFC 6901) to identify the
// location of the error within the request body.
// @see https://www.rfc-editor.org/rfc/rfc6901.html
// ---------------------------------------------------------------------------

export type ValidationError = { readonly detail: string; readonly pointer?: string }

export const ValidationErrorItem = Schema.Struct({
	detail: Schema.String,
	pointer: Schema.optional(Schema.String),
})

// ---------------------------------------------------------------------------
// formatSchemaIssues — structured SchemaError → ValidationError array
// ---------------------------------------------------------------------------

const standardSchemaV1Formatter = SchemaIssue.makeFormatterStandardSchemaV1()

/**
 * Converts a `Schema.SchemaError` into structured validation errors.
 * Each error includes a `detail` message and an optional `pointer` in
 * JSON Pointer format (RFC 6901) identifying the failing field.
 *
 * @see https://www.rfc-editor.org/rfc/rfc6901.html
 */
export function formatSchemaIssues(error: Schema.SchemaError): Array<ValidationError> {
	return standardSchemaV1Formatter(error.issue).issues.map(({ path, message }) =>
		path?.length ? { detail: message, pointer: `#/${path.join('/')}` } : { detail: message },
	)
}

// ---------------------------------------------------------------------------
// fromSchemaError — create a problem+json response from a structured SchemaError
// ---------------------------------------------------------------------------

/**
 * Creates a `problem+json` HttpServerResponse directly from a `Schema.SchemaError`.
 *
 * Uses the structured error formatter rather than parsing error message strings,
 * so it won't break if Effect changes its error message format.
 *
 * For HttpApi handlers, use `formatSchemaIssues` + `makeErrorClass` instead
 * (this returns an HttpServerResponse, not an error class instance).
 */
export function fromSchemaError(
	error: Schema.SchemaError,
	options?: {
		readonly status?: StatusCode
		readonly type?: string
		readonly detail?: string
		readonly instance?: string
		readonly extensions?: Extensions
	},
): HttpServerResponseType.HttpServerResponse {
	const status = options?.status ?? 400
	return HttpServerResponse.jsonUnsafe(
		{
			...options?.extensions,
			type: options?.type ?? 'about:blank',
			title: statusTitles[status],
			status,
			detail: options?.detail ?? 'The request did not match the expected schema',
			instance: options?.instance,
			errors: formatSchemaIssues(error),
		},
		{ status, contentType: 'application/problem+json' },
	)
}

// ---------------------------------------------------------------------------
// parseSchemaErrors — parse Effect schema error messages into RFC 9457
//                     validation error extension items (detail + pointer)
//
// This is a tertiary fallback. The middleware catches most SchemaErrors at the
// Effect level (catchIf) or as defects (catchDefect) using the structured
// SchemaIssue formatter. This string parser only activates for responses that
// are already rendered as application/json by error classes that don't use
// asProblemJson. It is fragile against Effect error-message format changes.
// ---------------------------------------------------------------------------

function parseBracketPath(raw: string): string {
	const segments = Array.from(raw.matchAll(/\["([^"]+)"\]|\[(\d+)\]/g), (m) => m[1] ?? m[2])
	return segments.length > 0 ? `#/${segments.join('/')}` : raw.replace(/^"|"$/g, '')
}

export function parseSchemaErrors(message: string): Array<ValidationError> {
	type Acc = {
		readonly errors: Array<ValidationError>
		readonly current: ValidationError | undefined
	}

	const { errors, current } = message
		.split('\n')
		.map((line) => line.trim())
		.filter(Boolean)
		.reduce<Acc>(
			(acc, line) => {
				const pathMatch = line.match(/^at (\[.+\])$/)
				if (pathMatch && acc.current) {
					return {
						errors: acc.errors,
						current: { ...acc.current, pointer: parseBracketPath(pathMatch[1]) },
					}
				}
				return {
					errors: acc.current ? [...acc.errors, acc.current] : acc.errors,
					current: { detail: line },
				}
			},
			{ errors: [], current: undefined },
		)

	const result = current ? [...errors, current] : errors
	return result.length > 0 ? result : [{ detail: message || 'Validation failed' }]
}

// ---------------------------------------------------------------------------
// middleware — global HttpRouter middleware that rewrites errors to problem+json
// ---------------------------------------------------------------------------

const decodeJsonRecord = Schema.decodeUnknownOption(
	Schema.fromJsonString(Schema.Record(Schema.String, Schema.Unknown)),
)
const textDecoder = new TextDecoder()

/**
 * Rewrites a 4xx response into `application/problem+json`.
 *
 * Handles two fallback cases (most SchemaErrors are caught at the Effect
 * level by `middleware()` before reaching this):
 * 1. **Empty-body 4xx** — produces a generic problem+json body.
 * 2. **JSON-body 4xx** — parses `_tag` and `message` from the body and
 *    rewrites to problem+json with structured validation errors.
 *
 * Returns the response unchanged for non-error or already-problem+json responses.
 */
export function transformResponse(
	response: HttpServerResponseType.HttpServerResponse,
	options?: { readonly typePrefix?: string },
): HttpServerResponseType.HttpServerResponse {
	const prefix = options?.typePrefix ?? '/problems/'

	if (response.status < 400) return response

	if (response.body._tag === 'Empty' && response.status >= 400 && response.status < 500) {
		return HttpServerResponse.jsonUnsafe(
			{
				type: `${prefix}${(statusTitles as Record<number, string>)[response.status]?.toLowerCase().replace(/\s+/g, '-') ?? 'error'}`,
				title: (statusTitles as Record<number, string>)[response.status] ?? 'Error',
				status: response.status,
				detail:
					response.status === 400
						? 'The request did not match the expected schema'
						: ((statusTitles as Record<number, string>)[response.status] ?? 'Client error'),
			},
			{ status: response.status, contentType: 'application/problem+json' },
		)
	}

	if (response.body._tag !== 'Uint8Array' || response.body.contentType !== 'application/json') {
		return response
	}

	return pipe(
		decodeJsonRecord(textDecoder.decode(response.body.body)),
		Option.map((parsed) => {
			const errors = parseSchemaErrors(String(parsed.message ?? ''))
			return HttpServerResponse.jsonUnsafe(
				{
					type: `${prefix}${String(parsed._tag ?? 'error')
						.toLowerCase()
						.replace(/\s+/g, '-')}`,
					title: (statusTitles as Record<number, string>)[response.status] ?? 'Error',
					status: response.status,
					detail: 'The request did not match the expected schema',
					errors,
				},
				{ status: response.status, contentType: 'application/problem+json' },
			)
		}),
		Option.getOrElse(() => response),
	)
}

/**
 * Global middleware that catches `Schema.SchemaError` at the Effect level
 * (producing structured validation details via `fromSchemaError`), transforms
 * any remaining 4xx responses to `application/problem+json`, and catches
 * unhandled defects with a safe 500 response.
 *
 * Three layers of defense, in order:
 * 1. `catchIf` — catches SchemaErrors in the error channel (HttpRouter routes)
 * 2. `transformResponse` — rewrites empty-body or JSON 4xx responses
 * 3. `catchDefect` — catches SchemaErrors that HttpApiBuilder converted to
 *     defects via `Effect.orDie(encodeError(...))`, plus any other defects
 *
 * **Execution order**: Effect applies global middleware in reverse registration
 * order. Place this as the **last** argument to `Layer.mergeAll` so it wraps
 * all other layers:
 *
 * @example
 * ```ts
 * const AppLive = HttpRouter.serve(
 *   Layer.mergeAll(ApiLive, SwaggerLive, ProblemJson.middleware()),
 * )
 * ```
 */
export function middleware(options?: { readonly typePrefix?: string }) {
	const prefix = options?.typePrefix ?? '/problems/'

	const safeServerError = HttpServerResponse.jsonUnsafe(
		{
			type: `${prefix}internal-server-error`,
			title: 'Internal Server Error',
			status: 500,
			detail: 'An unexpected error occurred',
		},
		{ status: 500, contentType: 'application/problem+json' },
	)

	return HttpRouter.middleware<{ handles: Schema.SchemaError }>()(
		(httpEffect) =>
			httpEffect.pipe(
				Effect.catchIf(Schema.isSchemaError, (error) =>
					Effect.succeed(fromSchemaError(error, { type: `${prefix}schema-error` })),
				),
				Effect.map((response) => transformResponse(response, { typePrefix: prefix })),
				Effect.catchDefect((defect) =>
					Effect.succeed(
						Schema.isSchemaError(defect)
							? fromSchemaError(defect, { type: `${prefix}schema-error` })
							: safeServerError,
					),
				),
			),
		{ global: true },
	)
}

// ---------------------------------------------------------------------------
// openApiTransform — rewrite generated OpenAPI spec for problem+json errors
// ---------------------------------------------------------------------------

type OpenApiSpec = Record<string, unknown>

const problemJsonSchemaErrorReplacement = {
	type: 'object',
	properties: {
		type: { type: 'string' },
		title: { type: 'string', enum: ['Bad Request'] },
		status: { type: 'integer', enum: [400] },
		detail: { type: 'string' },
		errors: {
			type: 'array',
			items: {
				type: 'object',
				properties: {
					detail: { type: 'string' },
					pointer: { type: 'string' },
				},
				required: ['detail'],
			},
		},
	},
	required: ['type', 'title', 'status', 'detail', 'errors'],
	additionalProperties: false,
} as const

function rewriteOperationResponse(op: Record<string, unknown>): void {
	const responses = op.responses as Record<string, Record<string, unknown>> | undefined
	const r400 = responses?.['400']
	const content = r400?.content as Record<string, unknown> | undefined
	if (r400 && content?.['application/json']) {
		content['application/problem+json'] = content['application/json']
		delete content['application/json']
		r400.description = 'Validation Error'
	}
}

export function openApiTransform(spec: OpenApiSpec): OpenApiSpec {
	const result = structuredClone(spec)

	const schemas = (result.components as Record<string, Record<string, unknown>> | undefined)
		?.schemas as Record<string, unknown> | undefined
	if (schemas?.effect_HttpApiSchemaError) {
		schemas.effect_HttpApiSchemaError = problemJsonSchemaErrorReplacement
	}

	const paths = result.paths as Record<string, Record<string, Record<string, unknown>>> | undefined
	Object.values(paths ?? {})
		.flatMap(Object.values)
		.forEach(rewriteOperationResponse)

	return result
}

// ---------------------------------------------------------------------------
// Pre-built error classes for common HTTP error statuses
// ---------------------------------------------------------------------------

export const BadRequest = makeErrorClass('BadRequest', 400)
export const Unauthorized = makeErrorClass('Unauthorized', 401)
export const PaymentRequired = makeErrorClass('PaymentRequired', 402)
export const Forbidden = makeErrorClass('Forbidden', 403)
export const NotFound = makeErrorClass('NotFound', 404)
export const MethodNotAllowed = makeErrorClass('MethodNotAllowed', 405)
export const Conflict = makeErrorClass('Conflict', 409)
export const Gone = makeErrorClass('Gone', 410)
export const UnprocessableContent = makeErrorClass('UnprocessableContent', 422)
export const TooManyRequests = makeErrorClass('TooManyRequests', 429)
export const InternalServerError = makeErrorClass('InternalServerError', 500)
export const NotImplemented = makeErrorClass('NotImplemented', 501)
export const BadGateway = makeErrorClass('BadGateway', 502)
export const ServiceUnavailable = makeErrorClass('ServiceUnavailable', 503)
export const GatewayTimeout = makeErrorClass('GatewayTimeout', 504)
