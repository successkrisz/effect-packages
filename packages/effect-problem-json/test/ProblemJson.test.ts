import { describe, expect, it } from '@effect/vitest'
import { Effect, Layer, Schema } from 'effect'
import { HttpServerResponse } from 'effect/unstable/http'
import * as ProblemJson from '../src/ProblemJson.ts'

function decodeBody(response: HttpServerResponse.HttpServerResponse): Record<string, unknown> {
	if (response.body._tag !== 'Uint8Array') throw new Error('Expected Uint8Array body')
	return JSON.parse(new TextDecoder().decode(response.body.body)) as Record<string, unknown>
}

const TestSchema = Schema.Struct({
	name: Schema.String,
	age: Schema.Number,
})

function getSchemaError(input: unknown): Schema.SchemaError {
	return Effect.runSync(Effect.flip(Schema.decodeUnknownEffect(TestSchema)(input)))
}

// ---------------------------------------------------------------------------
// formatSchemaIssues
// ---------------------------------------------------------------------------

describe('formatSchemaIssues', () => {
	it('returns structured errors with detail and pointer', () => {
		const error = getSchemaError({ name: 42 })
		const issues = ProblemJson.formatSchemaIssues(error)
		expect(issues.length).toBeGreaterThan(0)
		for (const issue of issues) {
			expect(typeof issue.detail).toBe('string')
		}
		const withPointers = issues.filter((e) => e.pointer)
		expect(withPointers.length).toBeGreaterThan(0)
		for (const issue of withPointers) {
			expect(issue.pointer).toMatch(/^#\//)
		}
	})

	it('returns errors without pointer for top-level issues', () => {
		const TopLevel = Schema.String
		const topError = Effect.runSync(Effect.flip(Schema.decodeUnknownEffect(TopLevel)(42)))
		const issues = ProblemJson.formatSchemaIssues(topError)
		expect(issues.length).toBeGreaterThan(0)
		expect(issues[0].pointer).toBeUndefined()
	})
})

// ---------------------------------------------------------------------------
// fromSchemaError
// ---------------------------------------------------------------------------

describe('fromSchemaError', () => {
	it('creates a 400 problem+json response with structured errors', () => {
		const error = getSchemaError({ name: 42, age: 'not a number' })
		const response = ProblemJson.fromSchemaError(error)
		expect(response.status).toBe(400)
		const body = decodeBody(response)
		expect(body.type).toBe('about:blank')
		expect(body.title).toBe('Bad Request')
		expect(body.status).toBe(400)
		expect(body.detail).toBe('The request did not match the expected schema')
		expect(Array.isArray(body.errors)).toBe(true)
		const errors = body.errors as Array<{ detail: string; pointer?: string }>
		expect(errors.length).toBeGreaterThan(0)
		for (const err of errors) {
			expect(typeof err.detail).toBe('string')
		}
	})

	it('includes JSON Pointer for field-level errors', () => {
		const error = getSchemaError({ name: 42 })
		const response = ProblemJson.fromSchemaError(error)
		const body = decodeBody(response)
		const errors = body.errors as Array<{ detail: string; pointer?: string }>
		const withPointers = errors.filter((e) => e.pointer)
		expect(withPointers.length).toBeGreaterThan(0)
		for (const err of withPointers) {
			expect(err.pointer).toMatch(/^#\//)
		}
	})

	it('allows overriding status to 422', () => {
		const error = getSchemaError({})
		const response = ProblemJson.fromSchemaError(error, { status: 422 })
		expect(response.status).toBe(422)
		const body = decodeBody(response)
		expect(body.status).toBe(422)
		expect(body.title).toBe('Unprocessable Content')
	})

	it('allows overriding type, detail, and instance', () => {
		const error = getSchemaError({})
		const response = ProblemJson.fromSchemaError(error, {
			type: '/problems/validation',
			detail: 'Custom detail message',
			instance: '/api/users/123',
		})
		const body = decodeBody(response)
		expect(body.type).toBe('/problems/validation')
		expect(body.title).toBe('Bad Request')
		expect(body.detail).toBe('Custom detail message')
		expect(body.instance).toBe('/api/users/123')
	})

	it('supports extensions that are flat-spread into the body', () => {
		const error = getSchemaError({})
		const response = ProblemJson.fromSchemaError(error, {
			extensions: { traceId: 'abc-123', requestId: 'req-456' },
		})
		const body = decodeBody(response)
		expect(body.traceId).toBe('abc-123')
		expect(body.requestId).toBe('req-456')
		expect(body.type).toBe('about:blank')
	})

	it('sets application/problem+json content type', () => {
		const error = getSchemaError({})
		const response = ProblemJson.fromSchemaError(error)
		if (response.body._tag === 'Uint8Array') {
			expect(response.body.contentType).toBe('application/problem+json')
		}
	})
})

// ---------------------------------------------------------------------------
// parseSchemaErrors
// ---------------------------------------------------------------------------

describe('parseSchemaErrors', () => {
	it('parses a single error without path', () => {
		const result = ProblemJson.parseSchemaErrors('Expected a string, actual 42')
		expect(result).toEqual([{ detail: 'Expected a string, actual 42' }])
	})

	it('parses multiple errors with bracket paths', () => {
		const input = [
			'Expected a string, actual 42',
			'  at ["name"]',
			'Expected a number, actual "abc"',
			'  at ["age"]',
		].join('\n')

		const result = ProblemJson.parseSchemaErrors(input)
		expect(result).toEqual([
			{ detail: 'Expected a string, actual 42', pointer: '#/name' },
			{ detail: 'Expected a number, actual "abc"', pointer: '#/age' },
		])
	})

	it('parses nested bracket paths into JSON pointers', () => {
		const input = ['Expected a boolean', '  at ["users"][0]["active"]'].join('\n')
		const result = ProblemJson.parseSchemaErrors(input)
		expect(result).toEqual([{ detail: 'Expected a boolean', pointer: '#/users/0/active' }])
	})

	it('returns a fallback when the message is empty', () => {
		expect(ProblemJson.parseSchemaErrors('')).toEqual([{ detail: 'Validation failed' }])
	})
})

// ---------------------------------------------------------------------------
// errorFields
// ---------------------------------------------------------------------------

describe('errorFields', () => {
	it('provides constructor defaults so only detail is required', () => {
		class TestError extends Schema.ErrorClass<TestError>('TestError')(
			ProblemJson.errorFields(422),
		) {}
		const error = new TestError({ detail: 'Invalid input' })
		expect(error.status).toBe(422)
		expect(error.title).toBe('Unprocessable Content')
		expect(error.type).toBe('about:blank')
		expect(error.detail).toBe('Invalid input')
	})

	it('allows overriding type while keeping other defaults', () => {
		class TestError extends Schema.ErrorClass<TestError>('TestError')(
			ProblemJson.errorFields(404),
		) {}
		const error = new TestError({ detail: 'Not here', type: '/problems/not-found' })
		expect(error.type).toBe('/problems/not-found')
		expect(error.title).toBe('Not Found')
		expect(error.status).toBe(404)
	})

	it('enforces status literal type', () => {
		expect(() => Schema.decodeUnknownSync(Schema.Literal(422))(400)).toThrow()
		expect(Schema.decodeUnknownSync(Schema.Literal(422))(422)).toBe(422)
	})
})

// ---------------------------------------------------------------------------
// makeErrorClass
// ---------------------------------------------------------------------------

describe('makeErrorClass', () => {
	it('creates an error class with make, Error, and problem', () => {
		const TodoNotFound = ProblemJson.makeErrorClass('TodoNotFound', 404)
		expect(TodoNotFound.Error).toBeDefined()
		expect(TodoNotFound.problem).toBeDefined()
		expect(typeof TodoNotFound.make).toBe('function')
	})

	it('make produces an instance with defaults', () => {
		const TodoNotFound = ProblemJson.makeErrorClass('TodoNotFound', 404)
		const error = TodoNotFound.make({ detail: 'Not found' })
		expect(error.status).toBe(404)
		expect(error.title).toBe('Not Found')
		expect(error.type).toBe('about:blank')
		expect(error.detail).toBe('Not found')
	})

	it('supports extension fields', () => {
		const WithExtensions = ProblemJson.makeErrorClass('WithExtensions', 400, {
			traceId: Schema.String,
			validationErrors: Schema.Array(ProblemJson.ValidationErrorItem),
		})
		const error = WithExtensions.make({
			detail: 'Validation failed',
			traceId: 'abc-123',
			validationErrors: [{ detail: 'Expected string', pointer: '#/name' }],
		})
		expect((error as unknown as Record<string, unknown>).traceId).toBe('abc-123')
		expect((error as unknown as Record<string, unknown>).validationErrors).toEqual([
			{ detail: 'Expected string', pointer: '#/name' },
		])
	})
})

// ---------------------------------------------------------------------------
// Pre-built error classes
// ---------------------------------------------------------------------------

describe('pre-built error classes', () => {
	it('NotFound produces a 404 error', () => {
		const error = ProblemJson.NotFound.make({ detail: 'User not found' })
		expect(error.status).toBe(404)
		expect(error.title).toBe('Not Found')
		expect(error.type).toBe('about:blank')
	})

	it('Unauthorized produces a 401 error', () => {
		const error = ProblemJson.Unauthorized.make({ detail: 'Missing token' })
		expect(error.status).toBe(401)
		expect(error.title).toBe('Unauthorized')
	})

	it('Conflict produces a 409 error', () => {
		const error = ProblemJson.Conflict.make({ detail: 'Duplicate entry' })
		expect(error.status).toBe(409)
		expect(error.title).toBe('Conflict')
	})

	it('InternalServerError produces a 500 error', () => {
		const error = ProblemJson.InternalServerError.make({ detail: 'Something broke' })
		expect(error.status).toBe(500)
		expect(error.title).toBe('Internal Server Error')
	})

	it('each pre-built has a .problem schema for endpoints', () => {
		expect(ProblemJson.NotFound.problem).toBeDefined()
		expect(ProblemJson.BadRequest.problem).toBeDefined()
		expect(ProblemJson.Forbidden.problem).toBeDefined()
		expect(ProblemJson.UnprocessableContent.problem).toBeDefined()
		expect(ProblemJson.InternalServerError.problem).toBeDefined()
	})
})

// ---------------------------------------------------------------------------
// makeResponse
// ---------------------------------------------------------------------------

describe('makeResponse', () => {
	it('creates a response with correct status and content-type', () => {
		const response = ProblemJson.makeResponse(404, 'Not here')
		expect(response.status).toBe(404)
		expect(response.body._tag).toBe('Uint8Array')
		if (response.body._tag === 'Uint8Array') {
			expect(response.body.contentType).toBe('application/problem+json')
		}
	})

	it('uses about:blank as default type and derives title from status', () => {
		const response = ProblemJson.makeResponse(400, 'Missing field')
		const body = decodeBody(response)
		expect(body.type).toBe('about:blank')
		expect(body.title).toBe('Bad Request')
		expect(body.status).toBe(400)
		expect(body.detail).toBe('Missing field')
	})

	it('uses provided type and instance', () => {
		const response = ProblemJson.makeResponse(409, 'Duplicate', {
			type: '/problems/conflict',
			instance: '/orders/123',
		})
		const body = decodeBody(response)
		expect(body.type).toBe('/problems/conflict')
		expect(body.title).toBe('Conflict')
		expect(body.instance).toBe('/orders/123')
	})

	it('derives title for all supported status codes', () => {
		const response = ProblemJson.makeResponse(418, 'Teapot')
		const body = decodeBody(response)
		expect(body.title).toBe("I'm a Teapot")
	})

	it('supports extensions that are flat-spread into the body', () => {
		const response = ProblemJson.makeResponse(500, 'Something broke', {
			extensions: { traceId: 'abc', issueRef: 'x1234' },
		})
		const body = decodeBody(response)
		expect(body.traceId).toBe('abc')
		expect(body.issueRef).toBe('x1234')
		expect(body.title).toBe('Internal Server Error')
	})
})

// ---------------------------------------------------------------------------
// transformResponse
// ---------------------------------------------------------------------------

describe('transformResponse', () => {
	it('rewrites a 4xx application/json response to problem+json', () => {
		const original = HttpServerResponse.jsonUnsafe(
			{ _tag: 'ValidationError', message: 'Expected a string' },
			{ status: 400 },
		)
		const result = ProblemJson.transformResponse(original)
		expect(result.status).toBe(400)
		if (result.body._tag === 'Uint8Array') {
			expect(result.body.contentType).toBe('application/problem+json')
			const body = JSON.parse(new TextDecoder().decode(result.body.body))
			expect(body.type).toBe('/problems/validationerror')
			expect(body.title).toBe('Bad Request')
			expect(body.errors).toEqual([{ detail: 'Expected a string' }])
		}
	})

	it('rewrites an empty-body 400 response to problem+json', () => {
		const original = HttpServerResponse.empty({ status: 400 })
		const result = ProblemJson.transformResponse(original)
		expect(result.status).toBe(400)
		if (result.body._tag === 'Uint8Array') {
			expect(result.body.contentType).toBe('application/problem+json')
			const body = JSON.parse(new TextDecoder().decode(result.body.body))
			expect(body.type).toBe('/problems/bad-request')
			expect(body.title).toBe('Bad Request')
			expect(body.status).toBe(400)
			expect(body.detail).toBe('The request did not match the expected schema')
		}
	})

	it('rewrites an empty-body 4xx (non-400) response to problem+json', () => {
		const original = HttpServerResponse.empty({ status: 404 })
		const result = ProblemJson.transformResponse(original)
		expect(result.status).toBe(404)
		if (result.body._tag === 'Uint8Array') {
			expect(result.body.contentType).toBe('application/problem+json')
			const body = JSON.parse(new TextDecoder().decode(result.body.body))
			expect(body.type).toBe('/problems/not-found')
			expect(body.title).toBe('Not Found')
			expect(body.status).toBe(404)
			expect(body.detail).toBe('Not Found')
		}
	})

	it('uses a custom typePrefix', () => {
		const original = HttpServerResponse.jsonUnsafe(
			{ _tag: 'NotFound', message: 'missing' },
			{ status: 404 },
		)
		const result = ProblemJson.transformResponse(original, { typePrefix: '/api/errors/' })
		if (result.body._tag === 'Uint8Array') {
			const body = JSON.parse(new TextDecoder().decode(result.body.body))
			expect(body.type).toBe('/api/errors/notfound')
		}
	})

	it('uses a custom typePrefix for empty-body responses', () => {
		const original = HttpServerResponse.empty({ status: 400 })
		const result = ProblemJson.transformResponse(original, { typePrefix: '/api/errors/' })
		if (result.body._tag === 'Uint8Array') {
			const body = JSON.parse(new TextDecoder().decode(result.body.body))
			expect(body.type).toBe('/api/errors/bad-request')
		}
	})

	it('leaves a 200 response unchanged', () => {
		const original = HttpServerResponse.jsonUnsafe({ ok: true }, { status: 200 })
		const result = ProblemJson.transformResponse(original)
		expect(result).toBe(original)
	})

	it('leaves a non-JSON 4xx response unchanged', () => {
		const original = HttpServerResponse.text('Not Found', { status: 404 })
		const result = ProblemJson.transformResponse(original)
		expect(result).toBe(original)
	})
})

// ---------------------------------------------------------------------------
// middleware
// ---------------------------------------------------------------------------

describe('middleware', () => {
	it('returns a Layer', () => {
		const mw = ProblemJson.middleware()
		expect(Layer.isLayer(mw)).toBe(true)
	})

	it('accepts a custom typePrefix option', () => {
		const mw = ProblemJson.middleware({ typePrefix: '/api/errors/' })
		expect(Layer.isLayer(mw)).toBe(true)
	})
})

// ---------------------------------------------------------------------------
// openApiTransform
// ---------------------------------------------------------------------------

describe('openApiTransform', () => {
	it('replaces the effect_HttpApiSchemaError schema', () => {
		const spec = {
			components: {
				schemas: {
					effect_HttpApiSchemaError: { type: 'object', properties: {} },
				},
			},
			paths: {},
		}
		const result = ProblemJson.openApiTransform(spec)
		const components = result.components as Record<string, Record<string, Record<string, unknown>>>
		const errorSchema = components.schemas.effect_HttpApiSchemaError
		expect(errorSchema.properties).toHaveProperty('type')
		expect(errorSchema.properties).toHaveProperty('errors')
		expect(errorSchema.required).toContain('errors')
	})

	it('swaps 400 content-type from application/json to application/problem+json', () => {
		const spec = {
			components: { schemas: {} },
			paths: {
				'/todos': {
					post: {
						responses: {
							'400': {
								description: 'Bad Request',
								content: {
									'application/json': { schema: { $ref: '#/components/schemas/Error' } },
								},
							},
						},
					},
				},
			},
		}
		const result = ProblemJson.openApiTransform(spec)
		const paths = result.paths as Record<string, Record<string, Record<string, unknown>>>
		const r400 = (paths['/todos'].post.responses as Record<string, Record<string, unknown>>)['400']
		const content = r400.content as Record<string, unknown>
		expect(content['application/problem+json']).toBeDefined()
		expect(content['application/json']).toBeUndefined()
		expect(r400.description).toBe('Validation Error')
	})

	it('leaves non-400 responses untouched', () => {
		const spec = {
			components: { schemas: {} },
			paths: {
				'/items': {
					get: {
						responses: {
							'200': {
								content: {
									'application/json': { schema: {} },
								},
							},
						},
					},
				},
			},
		}
		const result = ProblemJson.openApiTransform(spec)
		const paths = result.paths as Record<string, Record<string, Record<string, unknown>>>
		const r200 = (paths['/items'].get.responses as Record<string, Record<string, unknown>>)['200']
		const content = r200.content as Record<string, unknown>
		expect(content['application/json']).toBeDefined()
	})
})
