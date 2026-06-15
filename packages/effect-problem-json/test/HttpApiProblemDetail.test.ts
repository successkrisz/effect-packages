import { describe, expect, it } from '@effect/vitest'
import { Effect, Layer, Schema } from 'effect'
import type { HttpServerResponse } from 'effect/unstable/http'
import { HttpServerRespondable } from 'effect/unstable/http'
import { HttpApi, HttpApiEndpoint, HttpApiGroup, OpenApi } from 'effect/unstable/httpapi'
import * as HttpApiProblemDetail from '../src/HttpApiProblemDetail.ts'

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

describe('ProblemError', () => {
	it('creates a constructor with defaults and respondable behavior', () => {
		const TodoNotFound = HttpApiProblemDetail.ProblemError(
			'TodoNotFound',
			404,
		)({
			todoId: Schema.Number,
		})
		const error = new TodoNotFound({
			detail: 'Todo 42 was not found',
			todoId: 42,
		})
		const encoded = Schema.encodeUnknownSync(TodoNotFound)(error)
		const response = Effect.runSync(HttpServerRespondable.toResponse(error))

		expect(error._tag).toBe('TodoNotFound')
		expect(encoded).toEqual({
			type: 'about:blank',
			title: 'Not Found',
			status: 404,
			detail: 'Todo 42 was not found',
			todoId: 42,
		})
		expect(response.status).toBe(404)
		if (response.body._tag === 'Uint8Array') {
			expect(response.body.contentType).toBe('application/problem+json')
		}
		expect(decodeBody(response)).toEqual(encoded)
	})

	it('supports Effect.catchTag while omitting _tag from the encoded body', () => {
		const TodoNotFound = HttpApiProblemDetail.ProblemError(
			'TodoNotFound',
			404,
		)({
			todoId: Schema.Number,
		})
		const error = new TodoNotFound({
			detail: 'Todo 42 was not found',
			todoId: 42,
		})
		const encoded = Schema.encodeUnknownSync(TodoNotFound)(error)
		const handled = Effect.runSync(
			Effect.fail(error).pipe(Effect.catchTag('TodoNotFound', () => Effect.succeed('caught'))),
		)

		expect(error._tag).toBe('TodoNotFound')
		expect(handled).toBe('caught')
		expect(encoded).not.toHaveProperty('_tag')
	})
})

describe('built-in errors', () => {
	it('NotFound produces a 404 problem detail', () => {
		const error = new HttpApiProblemDetail.NotFound({ detail: 'User not found' })
		expect(error.status).toBe(404)
		expect(error.title).toBe('Not Found')
		expect(error.type).toBe('about:blank')
	})

	it('InternalServerError produces a 500 problem detail', () => {
		const error = new HttpApiProblemDetail.InternalServerError({ detail: 'Something broke' })
		expect(error.status).toBe(500)
		expect(error.title).toBe('Internal Server Error')
	})
})

describe('formatSchemaIssues', () => {
	it('returns structured errors with pointers when paths exist', () => {
		const error = getSchemaError({ name: 42 })
		const issues = HttpApiProblemDetail.formatSchemaIssues(error)

		expect(issues.length).toBeGreaterThan(0)
		expect(issues.some((issue) => issue.pointer?.startsWith('#/'))).toBe(true)
	})
})

describe('ValidationProblem', () => {
	it('builds a structured problem from a SchemaError', () => {
		const error = getSchemaError({ name: 42, age: 'not-a-number' })
		const problem = HttpApiProblemDetail.ValidationProblem.fromSchemaError(error)
		const encoded = Schema.encodeUnknownSync(HttpApiProblemDetail.ValidationProblem)(problem)

		expect(problem.status).toBe(400)
		expect(problem.title).toBe('Bad Request')
		expect(problem.errors.length).toBeGreaterThan(0)
		expect(Array.isArray(encoded.errors)).toBe(true)
	})

	it('renders a problem+json response from a SchemaError', () => {
		const error = getSchemaError({ name: 42 })
		const response = HttpApiProblemDetail.ValidationProblem.toResponse(error, {
			typePrefix: '/api/errors/',
		})
		const body = decodeBody(response)

		expect(response.status).toBe(400)
		expect(body.type).toBe('/api/errors/schema-error')
		expect(body.title).toBe('Bad Request')
		expect(body.detail).toBe('The request did not match the expected schema')
		expect(Array.isArray(body.errors)).toBe(true)
	})
})

describe('makeResponse', () => {
	it('creates a problem+json response with defaults', () => {
		const response = HttpApiProblemDetail.makeResponse(404, 'Not here')
		const body = decodeBody(response)

		expect(response.status).toBe(404)
		expect(body.type).toBe('about:blank')
		expect(body.title).toBe('Not Found')
		expect(body.status).toBe(404)
		expect(body.detail).toBe('Not here')
	})

	it('supports custom type, instance, and extensions', () => {
		const response = HttpApiProblemDetail.makeResponse(409, 'Duplicate', {
			type: '/problems/conflict',
			instance: '/orders/123',
			extensions: { traceId: 'abc-123' },
		})
		const body = decodeBody(response)

		expect(body.type).toBe('/problems/conflict')
		expect(body.instance).toBe('/orders/123')
		expect(body.traceId).toBe('abc-123')
	})
})

describe('middleware', () => {
	it('returns a Layer', () => {
		expect(Layer.isLayer(HttpApiProblemDetail.middleware())).toBe(true)
	})

	it('accepts a custom typePrefix option', () => {
		expect(Layer.isLayer(HttpApiProblemDetail.middleware({ typePrefix: '/api/errors/' }))).toBe(
			true,
		)
	})
})

describe('openApiTransform', () => {
	class Item extends Schema.Class<Item>('Item')({
		id: Schema.Number,
		name: Schema.String,
	}) {}

	class CreateItem extends Schema.Class<CreateItem>('CreateItem')({
		name: Schema.String,
		quantity: Schema.Number,
	}) {}

	const api = HttpApi.make('OpenApiTestApi')
		.add(
			HttpApiGroup.make('items').add(
				HttpApiEndpoint.post('createItem', '/items', {
					payload: CreateItem,
					success: Item,
				}),
			),
		)
		.annotate(OpenApi.Transform, HttpApiProblemDetail.openApiTransform)

	it('generated OpenAPI only shows problem+json for validation errors', () => {
		const spec = OpenApi.fromApi(api)
		const paths = spec.paths as Record<string, Record<string, Record<string, unknown>>>
		const responses = paths['/items'].post.responses as Record<string, Record<string, unknown>>
		const response400 = responses['400']
		const content = response400.content as Record<string, Record<string, unknown>>
		const components = spec.components as unknown as Record<string, Record<string, unknown>>
		const schemas = components.schemas as Record<string, Record<string, unknown>>

		expect(content['application/problem+json']).toBeDefined()
		expect(content['application/json']).toBeUndefined()
		expect((content['application/problem+json'].schema as Record<string, string>).$ref).toBe(
			'#/components/schemas/HttpApiProblemDetailValidationError',
		)
		expect(schemas.HttpApiProblemDetailValidationError).toBeDefined()
		expect(schemas.effect_HttpApiSchemaError).toBeUndefined()
	})

	it('generated OpenAPI adds problem+json for parameter validation errors', () => {
		const paramApi = HttpApi.make('OpenApiParamTestApi')
			.add(
				HttpApiGroup.make('items').add(
					HttpApiEndpoint.get('getItem', '/items/:id', {
						params: { id: Schema.NumberFromString },
						success: Item,
					}),
				),
			)
			.annotate(OpenApi.Transform, HttpApiProblemDetail.openApiTransform)
		const spec = OpenApi.fromApi(paramApi)
		const paths = spec.paths as Record<string, Record<string, Record<string, unknown>>>
		const responses = paths['/items/{id}'].get.responses as Record<string, Record<string, unknown>>
		const response400 = responses['400']
		const content = response400.content as Record<string, Record<string, unknown>>

		expect(content['application/problem+json']).toBeDefined()
		expect((content['application/problem+json'].schema as Record<string, string>).$ref).toBe(
			'#/components/schemas/HttpApiProblemDetailValidationError',
		)
	})

	it('preserves user-declared 400 schemas when rewriting validation responses', () => {
		const spec = HttpApiProblemDetail.openApiTransform({
			components: {
				schemas: {
					CustomBadRequest: {
						type: 'object',
						properties: {
							type: { type: 'string' },
							title: { type: 'string' },
							status: { type: 'integer' },
							detail: { type: 'string' },
							fieldErrors: {
								type: 'array',
								items: { type: 'string' },
							},
						},
					},
					effect_HttpApiSchemaError: {
						type: 'object',
					},
				},
			},
			paths: {
				'/items': {
					post: {
						responses: {
							400: {
								description: 'BadRequest | CustomBadRequest',
								content: {
									'application/json': {
										schema: {
											$ref: '#/components/schemas/CustomBadRequest',
										},
									},
								},
							},
						},
					},
				},
			},
		})
		const paths = spec.paths as Record<string, Record<string, Record<string, unknown>>>
		const responses = paths['/items'].post.responses as Record<string, Record<string, unknown>>
		const response400 = responses['400']
		const content = response400.content as Record<string, Record<string, unknown>>

		expect(response400.description).toBe('CustomBadRequest')
		expect(content['application/problem+json']).toBeDefined()
		expect(content['application/json']).toBeUndefined()
		expect((content['application/problem+json'].schema as Record<string, string>).$ref).toBe(
			'#/components/schemas/CustomBadRequest',
		)
	})

	it('rewrites an effect_HttpApiSchemaError $ref to the RFC 9457 schema ref', () => {
		const spec = HttpApiProblemDetail.openApiTransform({
			paths: {
				'/items': {
					post: {
						responses: {
							400: {
								description: 'BadRequest',
								content: {
									'application/json': {
										schema: {
											$ref: '#/components/schemas/effect_HttpApiSchemaError',
										},
									},
								},
							},
						},
					},
				},
			},
		})
		const paths = spec.paths as Record<string, Record<string, Record<string, unknown>>>
		const response400 = (paths['/items'].post.responses as Record<string, Record<string, unknown>>)[
			'400'
		]
		const content = response400.content as Record<string, Record<string, unknown>>

		expect(content['application/problem+json']).toBeDefined()
		expect(content['application/json']).toBeUndefined()
		expect((content['application/problem+json'].schema as Record<string, string>).$ref).toBe(
			'#/components/schemas/HttpApiProblemDetailValidationError',
		)
	})

	it('adds problem+json content when a 400 response has no content at all', () => {
		const spec = HttpApiProblemDetail.openApiTransform({
			paths: {
				'/items': {
					post: {
						responses: {
							400: {
								description: 'BadRequest',
							},
						},
					},
				},
			},
		})
		const paths = spec.paths as Record<string, Record<string, Record<string, unknown>>>
		const response400 = (paths['/items'].post.responses as Record<string, Record<string, unknown>>)[
			'400'
		]
		const content = response400.content as Record<string, Record<string, unknown>>

		expect(content['application/problem+json']).toBeDefined()
		expect((content['application/problem+json'].schema as Record<string, string>).$ref).toBe(
			'#/components/schemas/HttpApiProblemDetailValidationError',
		)
	})

	it('preserves an existing application/problem+json entry when no application/json is present', () => {
		const spec = HttpApiProblemDetail.openApiTransform({
			paths: {
				'/items': {
					post: {
						responses: {
							400: {
								description: 'BadRequest',
								content: {
									'application/problem+json': {
										schema: {
											$ref: '#/components/schemas/CustomBadRequest',
										},
									},
								},
							},
						},
					},
				},
			},
		})
		const paths = spec.paths as Record<string, Record<string, Record<string, unknown>>>
		const response400 = (paths['/items'].post.responses as Record<string, Record<string, unknown>>)[
			'400'
		]
		const content = response400.content as Record<string, Record<string, unknown>>

		expect(content['application/problem+json']).toBeDefined()
		expect((content['application/problem+json'].schema as Record<string, string>).$ref).toBe(
			'#/components/schemas/CustomBadRequest',
		)
	})

	it('normalizes a non-string description to "Bad Request"', () => {
		const spec = HttpApiProblemDetail.openApiTransform({
			paths: {
				'/items': {
					post: {
						responses: {
							400: {
								description: 42,
								content: {
									'application/json': {
										schema: { $ref: '#/components/schemas/CustomBadRequest' },
									},
								},
							},
						},
					},
				},
			},
		})
		const response400 = (
			(spec.paths as Record<string, Record<string, Record<string, unknown>>>)['/items'].post
				.responses as Record<string, Record<string, unknown>>
		)['400']

		expect(response400.description).toBe('Bad Request')
	})

	it('normalizes a description of only filtered-out entries to "Bad Request"', () => {
		const spec = HttpApiProblemDetail.openApiTransform({
			paths: {
				'/items': {
					post: {
						responses: {
							400: {
								description: 'BadRequest | <No Content>',
								content: {
									'application/json': {
										schema: { $ref: '#/components/schemas/CustomBadRequest' },
									},
								},
							},
						},
					},
				},
			},
		})
		const response400 = (
			(spec.paths as Record<string, Record<string, Record<string, unknown>>>)['/items'].post
				.responses as Record<string, Record<string, unknown>>
		)['400']

		expect(response400.description).toBe('Bad Request')
	})

	it('leaves non-400 responses untouched and does not remove their application/json content', () => {
		const spec = HttpApiProblemDetail.openApiTransform({
			paths: {
				'/items': {
					post: {
						responses: {
							200: {
								description: 'OK',
								content: {
									'application/json': {
										schema: { $ref: '#/components/schemas/Item' },
									},
								},
							},
							500: {
								description: 'ServerError',
								content: {
									'application/json': {
										schema: { $ref: '#/components/schemas/ServerError' },
									},
								},
							},
						},
					},
				},
			},
		})
		const responses = (spec.paths as Record<string, Record<string, Record<string, unknown>>>)[
			'/items'
		].post.responses as Record<string, Record<string, unknown>>
		const response200 = responses['200'] as Record<string, Record<string, unknown>>
		const response500 = responses['500'] as Record<string, Record<string, unknown>>

		expect(response200.description).toBe('OK')
		expect(response200.content['application/json']).toBeDefined()
		expect(response200.content['application/problem+json']).toBeUndefined()
		expect(response500.description).toBe('ServerError')
		expect(response500.content['application/json']).toBeDefined()
		expect(response500.content['application/problem+json']).toBeUndefined()
	})

	it('is a no-op when an operation has no 400 response entry', () => {
		const spec = HttpApiProblemDetail.openApiTransform({
			paths: {
				'/items': {
					get: {
						responses: {
							200: { description: 'OK' },
						},
					},
				},
			},
		})
		const responses = (spec.paths as Record<string, Record<string, Record<string, unknown>>>)[
			'/items'
		].get.responses as Record<string, Record<string, unknown>>

		expect(responses['400']).toBeUndefined()
		expect(responses['200']).toEqual({ description: 'OK' })
	})

	it('returns a valid spec when paths and components are absent', () => {
		const spec = HttpApiProblemDetail.openApiTransform({})
		const components = spec.components as Record<string, Record<string, unknown>> | undefined
		const schemas = components?.schemas

		expect(schemas?.HttpApiProblemDetailValidationError).toBeDefined()
		expect(schemas?.effect_HttpApiSchemaError).toBeUndefined()
		expect(spec.paths).toBeUndefined()
	})

	it('does not mutate the input spec', () => {
		const input = {
			components: {
				schemas: {
					effect_HttpApiSchemaError: { type: 'object' },
				},
			},
			paths: {
				'/items': {
					post: {
						responses: {
							400: {
								description: 'BadRequest',
								content: {
									'application/json': {
										schema: { $ref: '#/components/schemas/effect_HttpApiSchemaError' },
									},
								},
							},
						},
					},
				},
			},
		}
		const snapshot = JSON.parse(JSON.stringify(input))
		HttpApiProblemDetail.openApiTransform(input)

		expect(input).toEqual(snapshot)
	})
})
