import type { ServerResponse } from 'node:http'
import { describe, expect, it, vi } from '@effect/vitest'
import type {
	APIGatewayProxyEvent as AwsAPIGatewayProxyEvent,
	Context as AwsContext,
} from 'aws-lambda'
import { Context, Effect, Layer, pipe, Schema } from 'effect'
import { applyMiddleware, type Middleware } from '../src/applyMiddleware'
import {
	APIGatewayProxyEvent,
	type HandlerEffect,
	NormalizedHeaders,
	schemaBodyJson,
	schemaPathParams,
	toLambdaHandler,
} from '../src/RestApi'

const mockContext = {} as AwsContext

const createEvent = (
	body: string | null,
	isBase64Encoded = false,
	headers: { [key: string]: string | undefined } = {},
): AwsAPIGatewayProxyEvent => ({
	body,
	isBase64Encoded,
	headers,
	httpMethod: 'POST',
	path: '/',
	pathParameters: null,
	queryStringParameters: null,
	multiValueQueryStringParameters: null,
	stageVariables: null,
	requestContext: {} as unknown as AwsAPIGatewayProxyEvent['requestContext'],
	resource: '',
	multiValueHeaders: {},
})

describe('RestApi', () => {
	describe('NormalizedHeaders', () => {
		it('should normalize headers', async () => {
			const handler = NormalizedHeaders.pipe(
				Effect.map((headers) => ({
					statusCode: 200,
					body: JSON.stringify(headers),
				})),
				(eff) => toLambdaHandler(eff),
			)({ layer: Layer.empty })

			const event = createEvent(null, false, {
				'Content-Type': 'application/json',
				Foo: 'Bar',
			})

			const result = await handler(event, mockContext, () => {})

			expect(result).toEqual({
				statusCode: 200,
				body: JSON.stringify({
					'content-type': 'application/json',
					foo: 'Bar',
				}),
			})
		})
	})

	describe('toLambdaHandler', () => {
		it('should expose event on the context with original headers', async () => {
			let evt = {} as Context.Tag.Service<APIGatewayProxyEvent>

			const handler = APIGatewayProxyEvent.pipe(
				Effect.tap((e) => {
					evt = e
				}),
				Effect.as({ statusCode: 200, body: 'Woohoo' }),
				(eff) => toLambdaHandler(eff),
			)({ layer: Layer.empty })

			const body = JSON.stringify({ foo: 'bar' })
			const rawHeaders = { 'Content-Type': 'application/json' }
			const event = createEvent(body, false, rawHeaders)
			await handler(event, mockContext, () => {})

			expect(evt).toEqual(event)
		})

		it('should return effect result without body', async () => {
			const handler = toLambdaHandler(Effect.succeed({ statusCode: 200, body: 'Woohoo' }))({
				layer: Layer.empty,
			})

			const event = createEvent(null, false, {})
			const result = await handler(event, mockContext, () => {})

			expect(result?.statusCode).toBe(200)
			expect(result?.body).toBe('Woohoo')
		})

		it('should return effect result with body as empty string', async () => {
			const handler = toLambdaHandler(Effect.succeed({ statusCode: 200, body: 'Woohoo' }))({
				layer: Layer.empty,
			})

			const event = createEvent('', false, {})
			const result = await handler(event, mockContext, () => {})

			expect(result?.statusCode).toBe(200)
			expect(result?.body).toBe('Woohoo')
		})

		it('should return 200 with body when event body is provided', async () => {
			const handler = toLambdaHandler(Effect.succeed({ statusCode: 200, body: 'Woohoo' }))({
				layer: Layer.empty,
			})

			const event = createEvent('string body', false, {})
			const result = await handler(event, mockContext, () => {})

			expect(result?.statusCode).toBe(200)
			expect(result?.body).toBe('Woohoo')
		})

		it('should return 200 with decoded body when event body is base64 encoded', async () => {
			const handler = toLambdaHandler(Effect.succeed({ statusCode: 200, body: 'Woohoo' }))({
				layer: Layer.empty,
			})

			const base64Body = Buffer.from(JSON.stringify({ message: 'encoded json body' })).toString(
				'base64',
			)
			const event = createEvent(base64Body, true, {
				'content-type': 'application/json',
			})
			const result = await handler(event, mockContext, () => {})

			expect(result?.statusCode).toBe(200)
			expect(result?.body).toBe('Woohoo')
		})

		it('should return 500 when an error occurs', async () => {
			const handler = toLambdaHandler(Effect.die(new Error('Something went wrong')))({
				layer: Layer.empty,
			})

			const event = createEvent(null, false, {})
			const result = await handler(event, mockContext, () => {})

			expect(result?.statusCode).toBe(500)
			expect(result?.body).toBe(JSON.stringify({ message: 'Internal Server Error' }))
		})
	})

	describe('schemaBodyJson', () => {
		it('should parse JSON body', async () => {
			const schema = Schema.Struct({ foo: Schema.String })
			const handler = schemaBodyJson(schema).pipe(
				Effect.map((body) => ({
					statusCode: 200,
					body: JSON.stringify(body),
				})),
				Effect.orDie,
				(eff) => toLambdaHandler(eff),
			)({ layer: Layer.empty })

			const body = { foo: 'bar' }
			const event = createEvent(JSON.stringify(body), false, {
				'Content-Type': 'application/json',
			})
			const result = await handler(event, mockContext, () => {})

			expect(result).toEqual({
				statusCode: 200,
				body: JSON.stringify(body),
			})
		})

		it('should return ParseError when body is not valid JSON', async () => {
			const schema = Schema.Struct({ foo: Schema.String })
			const handler = schemaBodyJson(schema).pipe(
				Effect.map((body) => ({
					statusCode: 200,
					body: JSON.stringify(body),
				})),
				Effect.catchTag('ParseError', () =>
					Effect.succeed({
						statusCode: 400,
						body: 'ParseError',
					}),
				),
				(eff) => toLambdaHandler(eff),
			)({ layer: Layer.empty })

			const event = createEvent('invalid json', false, {
				'content-type': 'application/json',
			})
			const result = await handler(event, mockContext, () => {})

			expect(result?.statusCode).toBe(400)
			expect(result?.body).toBe('ParseError')
		})

		it('should return ParseError when body in not matching schema', async () => {
			const schema = Schema.Struct({ foo: Schema.String })
			const handler = schemaBodyJson(schema).pipe(
				Effect.map((body) => ({
					statusCode: 200,
					body: JSON.stringify(body),
				})),
				Effect.catchTag('ParseError', () =>
					Effect.succeed({
						statusCode: 400,
						body: 'ParseError',
					}),
				),
				(eff) => toLambdaHandler(eff),
			)({ layer: Layer.empty })

			const event = createEvent(JSON.stringify({ bar: 'baz' }), false, {
				'content-type': 'application/json',
			})
			const result = await handler(event, mockContext, () => {})

			expect(result?.statusCode).toBe(400)
			expect(result?.body).toBe('ParseError')
		})
	})

	describe('NormalizedHeaders', () => {
		it('should access normalized headers, via component', async () => {
			const headersM: { [key: string]: string | undefined }[] = []
			const handler = NormalizedHeaders.pipe(
				Effect.map((headers) => {
					headersM.push(headers)
					return {
						statusCode: 200,
						body: JSON.stringify(headers),
					}
				}),
				(eff) => toLambdaHandler(eff),
			)({ layer: Layer.empty })

			const event1 = createEvent(null, false, {
				'Content-Type': 'application/json',
				Foo: 'Bar',
			})

			const result1 = await handler(event1, mockContext, () => {})

			const event2 = createEvent(null, false, {
				'Content-Type': 'application/json',
				Foo: 'Baz',
			})

			const result2 = await handler(event2, mockContext, () => {})

			expect(result1).toEqual({
				statusCode: 200,
				body: JSON.stringify({
					'content-type': 'application/json',
					foo: 'Bar',
				}),
			})
			expect(headersM[0]).toEqual({
				'content-type': 'application/json',
				foo: 'Bar',
			})
			expect(result2).toEqual({
				statusCode: 200,
				body: JSON.stringify({
					'content-type': 'application/json',
					foo: 'Baz',
				}),
			})
			expect(headersM[1]).toEqual({
				'content-type': 'application/json',
				foo: 'Baz',
			})
		})
	})

	// ====================
	// Readme examples
	// ====================
	it('should access input event as in the readme example', async () => {
		const PayloadSchema = Schema.Struct({
			message: Schema.String,
		})
		const PathParamsSchema = Schema.Struct({
			name: Schema.String,
		})
		const handler = schemaPathParams(PathParamsSchema).pipe(
			Effect.map(({ name }) => name),
			Effect.bindTo('name'),
			Effect.bind('message', () =>
				schemaBodyJson(PayloadSchema).pipe(Effect.map((x) => x.message)),
			),
			Effect.map(({ name, message }) => ({
				statusCode: 200,
				body: `Hello ${name}, ${message}`,
			})),
			Effect.catchTag('ParseError', () =>
				Effect.succeed({
					statusCode: 400,
					body: 'Invalid JSON',
				}),
			),
			// toLambdaHandler,
			(eff) => toLambdaHandler(eff),
			(x) => x,
		)({ layer: Layer.empty })

		const event = {
			...createEvent(JSON.stringify({ message: 'goodbye!' }), false, {
				'Content-Type': 'application/json',
			}),
			pathParameters: { name: 'John' },
		}

		const result = await handler(event, mockContext, () => {})

		console.log(result)

		expect(result?.statusCode).toBe(200)
		expect(result?.body).toBe('Hello John, goodbye!')
	})

	it('should work with the helmet middleware applied', async () => {
		const middleware = vi.fn().mockImplementation((_, res: ServerResponse) => {
			res.setHeader('X-XSS-Protection', '0')
		}) as Middleware

		const handlerEffect: HandlerEffect<never> = Effect.succeed({
			statusCode: 200,
			body: 'Woohoo',
		})
		const handler = pipe(handlerEffect, Effect.map(applyMiddleware(middleware)), (eff) =>
			toLambdaHandler(eff),
		)({ layer: Layer.empty })

		const event = createEvent(null, false, {})
		const result = await handler(event, mockContext, () => {})

		expect(result).toEqual({
			statusCode: 200,
			body: 'Woohoo',
			headers: { 'X-XSS-Protection': '0' },
		})
		expect
	})

	it('should work when composed', async () => {
		const middleware = vi.fn().mockImplementation((_, res: ServerResponse) => {
			res.setHeader('X-XSS-Protection', '0')
		}) as Middleware

		class FooLogger extends Context.Tag('FooLogger')<
			FooLogger,
			{ log: (message: string) => Effect.Effect<void> }
		>() {}

		const handlerEffect = Effect.succeed({
			statusCode: 200,
			body: 'Woohoo',
		}).pipe(Effect.tap(() => Effect.flatMap(FooLogger, (logger) => logger.log('Woohoo'))))

		const toHandler = <R, E = never>(effect: HandlerEffect<R>) =>
			effect.pipe(Effect.map(applyMiddleware(middleware)), (eff) => toLambdaHandler<R, E>(eff))

		const handler = toHandler(handlerEffect)({
			layer: Layer.succeed(FooLogger, { log: () => Effect.void }),
		})
		const event = createEvent(null, false, {})
		const result = await handler(event, mockContext, () => {})

		expect(result?.statusCode).toEqual(200)
		expect(result?.headers).toEqual({ 'X-XSS-Protection': '0' })
	})
})
