/**
 * Reusable building blocks for RFC 9457 (Problem Details for HTTP APIs)
 * with Effect HttpApi.
 *
 * @see https://www.rfc-editor.org/rfc/rfc9457.html
 */
import { Effect, ErrorReporter, Option, Schema, SchemaIssue } from 'effect'
import { HttpRouter, HttpServerRespondable, HttpServerResponse } from 'effect/unstable/http'
import { HttpApiError, HttpApiSchema } from 'effect/unstable/httpapi'

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

type ProblemBaseKeys = 'type' | 'title' | 'status' | 'detail' | 'instance'
type ProblemResponseBody = {
	readonly type: string
	readonly title: string
	readonly status: StatusCode
	readonly detail: string
	readonly instance?: string
} & Record<string, unknown>
type ProblemExtensions = { readonly [K in ProblemBaseKeys]?: never } & Readonly<
	Record<string, unknown>
>

type OpenApiSpec = Record<string, unknown>

const problemJsonContentType = 'application/problem+json'
const validationProblemSchemaName = 'HttpApiProblemDetailValidationError'
const validationProblemDetail = 'The request did not match the expected schema'
// Effect currently injects BadRequestFromSchemaError as this schema ref in 400 responses.
const effectValidationProblemSchemaRef = '#/components/schemas/effect_HttpApiSchemaError'
const validationProblemSchemaRef = `#/components/schemas/${validationProblemSchemaName}`
const standardSchemaV1Formatter = SchemaIssue.makeFormatterStandardSchemaV1()
const textDecoder = new TextDecoder()

const ValidationIssue = Schema.Struct({
	detail: Schema.String,
	pointer: Schema.optional(Schema.String),
})

const ProblemDetailWireShape = Schema.Struct({
	type: Schema.String,
	title: Schema.String,
	status: Schema.Finite,
	detail: Schema.String,
})

const decodeProblemDetailWireShape = Schema.decodeUnknownOption(
	Schema.fromJsonString(ProblemDetailWireShape),
)

function isStatusCode(status: number): status is StatusCode {
	return Object.hasOwn(statusTitles, String(status))
}

function slugify(value: string): string {
	return value
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, '-')
		.replace(/^-+|-+$/g, '')
}

function problemTypeFromStatus(status: StatusCode, prefix: string): string {
	return `${prefix}${slugify(statusTitles[status])}`
}

function isJsonContentType(contentType: string): boolean {
	return contentType === 'application/json' || contentType.startsWith('application/json;')
}

function makeProblemBody(
	status: StatusCode,
	detail: string,
	options?: {
		readonly type?: string
		readonly title?: string
		readonly instance?: string
		readonly extensions?: ProblemExtensions
	},
): ProblemResponseBody {
	return {
		...options?.extensions,
		type: options?.type ?? 'about:blank',
		title: options?.title ?? statusTitles[status],
		status,
		detail,
		instance: options?.instance,
	}
}

function makeProblemSchema<
	Tag extends string,
	S extends StatusCode,
	Fields extends Schema.Struct.Fields,
>(tag: Tag, status: S, extensions: Fields) {
	const type = Schema.withConstructorDefault<typeof Schema.String>(Effect.succeed('about:blank'))(
		Schema.String,
	)
	const title = Schema.withConstructorDefault<typeof Schema.String>(
		Effect.succeed(statusTitles[status]),
	)(Schema.String)
	const statusField = Schema.Literal(status)

	return Schema.Struct({
		_tag: Schema.tagDefaultOmit(tag),
		type,
		title,
		status: Schema.withConstructorDefault<typeof statusField>(Effect.succeed(status))(statusField),
		detail: Schema.String,
		instance: Schema.optional(Schema.String),
		...extensions,
	}).pipe(HttpApiSchema.asJson({ contentType: problemJsonContentType }))
}

function makeFallbackResponse(status: StatusCode, typePrefix: string) {
	const detail =
		status === 400
			? validationProblemDetail
			: status === 500
				? 'An unexpected error occurred'
				: statusTitles[status]
	const type =
		status === 400 ? `${typePrefix}schema-error` : problemTypeFromStatus(status, typePrefix)

	return HttpServerResponse.jsonUnsafe(makeProblemBody(status, detail, { type }), {
		status,
		contentType: problemJsonContentType,
	})
}

function isEffectValidationProblemSchema(schema: unknown): boolean {
	return (
		typeof schema === 'object' &&
		schema !== null &&
		'$ref' in schema &&
		(schema as { readonly $ref?: unknown }).$ref === effectValidationProblemSchemaRef
	)
}

function validationProblemContent() {
	return {
		schema: {
			$ref: validationProblemSchemaRef,
		},
	}
}

function mergeValidationProblemEntry(source: Record<string, unknown>): Record<string, unknown> {
	return {
		...source,
		schema: isEffectValidationProblemSchema(source.schema)
			? validationProblemContent().schema
			: source.schema,
	}
}

function rewriteValidationProblemContent(
	content: Record<string, unknown> | undefined,
): Record<string, unknown> {
	const { 'application/json': jsonEntry, ...rest } = content ?? {}
	const source = (rest[problemJsonContentType] ?? jsonEntry) as Record<string, unknown> | undefined

	return {
		...rest,
		[problemJsonContentType]: Option.fromNullishOr(source).pipe(
			Option.map(mergeValidationProblemEntry),
			Option.getOrElse(validationProblemContent),
		),
	}
}

function normalizeValidationDescription(description: unknown): string {
	if (typeof description !== 'string') {
		return 'Bad Request'
	}

	const cleaned = description
		.split(' | ')
		.filter((entry) => entry.length > 0 && entry !== 'BadRequest' && entry !== '<No Content>')

	return cleaned.length > 0 ? cleaned.join(' | ') : 'Bad Request'
}

function hasRequestValidation(operation: Record<string, unknown>): boolean {
	if (operation.requestBody !== undefined) {
		return true
	}
	const parameters = operation.parameters
	return Array.isArray(parameters) && parameters.length > 0
}

function isProblemDetailJsonBody(status: number, body: Uint8Array): boolean {
	const decoded = decodeProblemDetailWireShape(textDecoder.decode(body))
	return Option.isSome(decoded) && decoded.value.status === status
}

function isValidationProblemError(
	error: unknown,
): error is Schema.SchemaError | HttpApiError.HttpApiSchemaError {
	return Schema.isSchemaError(error) || HttpApiError.HttpApiSchemaError.is(error)
}

function validationResponseFromError(
	error: Schema.SchemaError | HttpApiError.HttpApiSchemaError,
	typePrefix: string,
): HttpServerResponse.HttpServerResponse {
	const schemaError = Schema.isSchemaError(error) ? error : error.cause
	return ValidationProblem.toResponse(schemaError, { typePrefix })
}

export function ProblemError<Tag extends string, Status extends StatusCode>(
	tag: Tag,
	status: Status,
) {
	return <Fields extends Schema.Struct.Fields = Record<never, never>>(extensions?: Fields) => {
		const schema = makeProblemSchema(tag, status, (extensions ?? {}) as Fields)
		type ProblemBrand = {
			[HttpServerRespondable.symbol](): Effect.Effect<HttpServerResponse.HttpServerResponse>
		}
		type ProblemShape = Schema.Schema.Type<typeof schema> & ProblemBrand

		const ProblemHttpError = Schema.ErrorClass<ProblemShape, ProblemBrand>(
			`@ballatech/effect-problem-json/${tag}`,
		)(schema, {
			description: tag,
			httpApiStatus: status,
		})
		// biome-ignore lint/suspicious/noExplicitAny: generic schema encoding services stay precise on the returned class, but encodeUnknownSync needs a concrete encoder here
		const encode = Schema.encodeUnknownSync(schema as any)
		// This patches the generated ErrorClass constructor with the runtime pieces
		// Effect HttpApi does not expose declaratively yet.
		const Prototype = ProblemHttpError as unknown as { prototype: ProblemShape }
		const descriptors: PropertyDescriptorMap = {
			[HttpServerRespondable.symbol]: {
				value(this: ProblemShape) {
					return Effect.map(
						Effect.sync(() => encode(this)),
						(encoded) =>
							HttpServerResponse.jsonUnsafe(encoded, {
								status,
								contentType: problemJsonContentType,
							}),
					)
				},
			},
		}

		if (status < 500) {
			descriptors[ErrorReporter.ignore] = {
				value: true,
				writable: false,
				enumerable: true,
			}
		}

		Object.defineProperties(Prototype.prototype, descriptors)

		return ProblemHttpError
	}
}

export function makeResponse(
	status: StatusCode,
	detail: string,
	options?: {
		readonly type?: string
		readonly title?: string
		readonly instance?: string
		readonly extensions?: ProblemExtensions
	},
): HttpServerResponse.HttpServerResponse {
	return HttpServerResponse.jsonUnsafe(makeProblemBody(status, detail, options), {
		status,
		contentType: problemJsonContentType,
	})
}

export function formatSchemaIssues(
	error: Schema.SchemaError,
): Array<{ readonly detail: string; readonly pointer?: string }> {
	return standardSchemaV1Formatter(error.issue).issues.map(({ path, message }) =>
		path !== undefined && path.length > 0
			? { detail: message, pointer: `#/${path.join('/')}` }
			: { detail: message },
	)
}

const ValidationProblemBase = ProblemError(
	'ValidationProblem',
	400,
)({
	errors: Schema.Array(ValidationIssue),
})

export const ValidationProblem = Object.assign(ValidationProblemBase, {
	fromSchemaError(
		error: Schema.SchemaError,
		options?: {
			readonly type?: string
			readonly detail?: string
			readonly instance?: string
		},
	) {
		return new ValidationProblemBase({
			type: options?.type ?? 'about:blank',
			detail: options?.detail ?? validationProblemDetail,
			instance: options?.instance,
			errors: formatSchemaIssues(error),
		})
	},

	toResponse(
		error: Schema.SchemaError,
		options?: {
			readonly typePrefix?: string
			readonly detail?: string
			readonly instance?: string
		},
	): HttpServerResponse.HttpServerResponse {
		return makeResponse(400, options?.detail ?? validationProblemDetail, {
			type: `${options?.typePrefix ?? '/problems/'}schema-error`,
			instance: options?.instance,
			extensions: {
				errors: formatSchemaIssues(error),
			},
		})
	},
})

export function middleware(options?: { readonly typePrefix?: string }) {
	const prefix = options?.typePrefix ?? '/problems/'
	const safeServerError = makeFallbackResponse(500, prefix)

	return HttpRouter.middleware<{
		provides: never
		handles: Schema.SchemaError | HttpApiError.HttpApiSchemaError
	}>()(
		(httpEffect) =>
			httpEffect.pipe(
				Effect.catchIf(isValidationProblemError, (error) =>
					Effect.succeed(validationResponseFromError(error, prefix)),
				),
				Effect.map((response) => {
					if (
						response.body._tag === 'Empty' &&
						response.status >= 400 &&
						isStatusCode(response.status)
					) {
						const fallback = makeFallbackResponse(response.status, prefix)
						if (fallback.body._tag === 'Uint8Array') {
							return HttpServerResponse.uint8Array(fallback.body.body, {
								status: fallback.status,
								statusText: response.statusText,
								headers: response.headers,
								cookies: response.cookies,
								contentType: fallback.body.contentType,
							})
						}
						return fallback
					}
					if (
						response.status >= 400 &&
						isStatusCode(response.status) &&
						response.body._tag === 'Uint8Array' &&
						isJsonContentType(response.body.contentType) &&
						isProblemDetailJsonBody(response.status, response.body.body)
					) {
						return HttpServerResponse.uint8Array(response.body.body, {
							status: response.status,
							statusText: response.statusText,
							headers: response.headers,
							cookies: response.cookies,
							contentType: problemJsonContentType,
						})
					}
					return response
				}),
				Effect.catchDefect((defect) => {
					if (isValidationProblemError(defect)) {
						return Effect.succeed(validationResponseFromError(defect, prefix))
					}

					return Effect.flatMap(Effect.logError(defect), () => Effect.succeed(safeServerError))
				}),
			),
		{ global: true },
	)
}

const validationProblemSchema = {
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
				additionalProperties: false,
			},
		},
	},
	required: ['type', 'title', 'status', 'detail', 'errors'],
	additionalProperties: false,
} as const

export function openApiTransform(spec: OpenApiSpec): OpenApiSpec {
	const result = structuredClone(spec)
	const components = (result.components as Record<string, unknown> | undefined) ?? {}
	result.components = components

	const schemas = (components.schemas as Record<string, unknown> | undefined) ?? {}
	components.schemas = schemas

	delete schemas.effect_HttpApiSchemaError
	schemas[validationProblemSchemaName] = validationProblemSchema

	const paths = result.paths as Record<string, Record<string, Record<string, unknown>>> | undefined

	for (const path of Object.values(paths ?? {})) {
		for (const operation of Object.values(path)) {
			const responses = operation.responses as Record<string, Record<string, unknown>> | undefined
			const response = responses?.['400']
			if (response === undefined) {
				if (!hasRequestValidation(operation)) continue
				const nextResponses = responses ?? {}
				operation.responses = nextResponses
				nextResponses['400'] = {
					description: 'Bad Request',
					content: rewriteValidationProblemContent(undefined),
				}
				continue
			}

			const content = response.content as Record<string, unknown> | undefined
			response.content = rewriteValidationProblemContent(content)
			response.description = normalizeValidationDescription(response.description)
		}
	}

	return result
}

export const BadRequest = ProblemError('BadRequest', 400)()
export const Unauthorized = ProblemError('Unauthorized', 401)()
export const PaymentRequired = ProblemError('PaymentRequired', 402)()
export const Forbidden = ProblemError('Forbidden', 403)()
export const NotFound = ProblemError('NotFound', 404)()
export const MethodNotAllowed = ProblemError('MethodNotAllowed', 405)()
export const Conflict = ProblemError('Conflict', 409)()
export const Gone = ProblemError('Gone', 410)()
export const UnprocessableContent = ProblemError('UnprocessableContent', 422)()
export const TooManyRequests = ProblemError('TooManyRequests', 429)()
export const InternalServerError = ProblemError('InternalServerError', 500)()
export const NotImplemented = ProblemError('NotImplemented', 501)()
export const BadGateway = ProblemError('BadGateway', 502)()
export const ServiceUnavailable = ProblemError('ServiceUnavailable', 503)()
export const GatewayTimeout = ProblemError('GatewayTimeout', 504)()
