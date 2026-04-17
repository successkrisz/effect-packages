import { describe, expect, it } from '@effect/vitest'
import { LambdaHandler } from '@effect-aws/lambda'
import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2, Context } from 'aws-lambda'
import { Effect, Layer, Schema } from 'effect'
import { HttpServer } from 'effect/unstable/http'
import {
	HttpApi,
	HttpApiBuilder,
	HttpApiEndpoint,
	HttpApiGroup,
	HttpApiSchema,
} from 'effect/unstable/httpapi'
import * as HttpApiProblemDetail from '../src/HttpApiProblemDetail.ts'

// ---------------------------------------------------------------------------
// Mock helpers
// ---------------------------------------------------------------------------

const mockLambdaContext: Context = {
	callbackWaitsForEmptyEventLoop: true,
	functionName: 'test-function',
	functionVersion: '$LATEST',
	invokedFunctionArn: 'arn:aws:lambda:us-east-1:123456789012:function:test',
	memoryLimitInMB: '128',
	awsRequestId: 'test-request-id',
	logGroupName: '/aws/lambda/test',
	logStreamName: '2025/01/01/[$LATEST]test',
	getRemainingTimeInMillis: () => 5000,
	done: () => {},
	fail: () => {},
	succeed: () => {},
}

function createApiGwV2Event(
	method: string,
	path: string,
	body?: unknown,
	headers: Record<string, string> = {},
): APIGatewayProxyEventV2 {
	const hasBody = body !== undefined
	const bodyStr = hasBody ? JSON.stringify(body) : undefined
	return {
		version: '2.0',
		routeKey: `${method} ${path}`,
		rawPath: path,
		rawQueryString: '',
		headers: {
			host: 'test.execute-api.us-east-1.amazonaws.com',
			...(hasBody ? { 'content-type': 'application/json' } : {}),
			...headers,
		},
		requestContext: {
			accountId: '123456789012',
			apiId: 'test-api',
			domainName: 'test.execute-api.us-east-1.amazonaws.com',
			domainPrefix: 'test',
			http: {
				method,
				path,
				protocol: 'HTTP/1.1',
				sourceIp: '127.0.0.1',
				userAgent: 'vitest',
			},
			requestId: 'test-request-id',
			routeKey: `${method} ${path}`,
			stage: '$default',
			time: '01/Jan/2025:00:00:00 +0000',
			timeEpoch: Date.now(),
		},
		body: bodyStr,
		isBase64Encoded: false,
	}
}

type ParsedResult = {
	statusCode: number
	body: Record<string, unknown> | null
	rawBody: string
	headers: Record<string, string>
	contentType: string | undefined
}

function parseResult(result: APIGatewayProxyResultV2): ParsedResult {
	if (typeof result === 'string') throw new Error('Expected structured result, got string')
	const rawBody = result.body ?? ''
	let body: Record<string, unknown> | null = null
	try {
		if (rawBody) body = JSON.parse(rawBody) as Record<string, unknown>
	} catch {}
	return {
		statusCode: result.statusCode ?? 200,
		body,
		rawBody,
		headers: (result.headers as Record<string, string>) ?? {},
		contentType: (result.headers as Record<string, string> | undefined)?.['content-type'],
	}
}

// ---------------------------------------------------------------------------
// Test API definition
// ---------------------------------------------------------------------------

class Item extends Schema.Class<Item>('Item')({
	id: Schema.Number,
	name: Schema.String,
}) {}

class CreateItem extends Schema.Class<CreateItem>('CreateItem')({
	name: Schema.String,
	quantity: Schema.Number,
}) {}

class JsonConflictPayload extends Schema.Class<JsonConflictPayload>('JsonConflictPayload')({
	message: Schema.String,
}) {}

const itemsGroup = HttpApiGroup.make('items')
	.add(
		HttpApiEndpoint.get('getItem', '/items/:id', {
			params: { id: Schema.NumberFromString },
			success: Item,
			error: HttpApiProblemDetail.NotFound,
		}),
	)
	.add(
		HttpApiEndpoint.post('createItem', '/items', {
			payload: CreateItem,
			success: Item.pipe(HttpApiSchema.status(201)),
		}),
	)
	.add(
		HttpApiEndpoint.get('crashItem', '/items/crash', {
			success: Item,
		}),
	)
	.add(
		HttpApiEndpoint.get('jsonConflict', '/items/json-conflict', {
			success: JsonConflictPayload.pipe(HttpApiSchema.status(409)),
		}),
	)

const api = HttpApi.make('TestApi').add(itemsGroup)

const ItemsLive = HttpApiBuilder.group(api, 'items', (handlers) =>
	handlers
		.handle('getItem', ({ params }) =>
			Effect.fail(
				new HttpApiProblemDetail.NotFound({ detail: `Item with id ${params.id} was not found` }),
			),
		)
		.handle('createItem', ({ payload }) => Effect.succeed(new Item({ id: 1, name: payload.name })))
		.handle('crashItem', () => Effect.die(new Error('Unexpected failure')))
		.handle('jsonConflict', () =>
			Effect.succeed(new JsonConflictPayload({ message: 'Version conflict' })),
		),
)

const ApiLive = Layer.provide(HttpApiBuilder.layer(api), [ItemsLive, HttpServer.layerServices])

// ---------------------------------------------------------------------------
// Lambda handler: WITH middleware
// ---------------------------------------------------------------------------

const handlerWithMiddleware = LambdaHandler.fromHttpApi(
	Layer.mergeAll(ApiLive, HttpApiProblemDetail.middleware()),
)

// ---------------------------------------------------------------------------
// Lambda handler: WITHOUT middleware (baseline comparison)
// ---------------------------------------------------------------------------

const handlerWithoutMiddleware = LambdaHandler.fromHttpApi(ApiLive)

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

async function invoke(
	handler: ReturnType<typeof LambdaHandler.fromHttpApi>,
	method: string,
	path: string,
	body?: unknown,
): Promise<ParsedResult> {
	const event = createApiGwV2Event(method, path, body)
	const raw = (await handler(event, mockLambdaContext)) as APIGatewayProxyResultV2
	return parseResult(raw)
}

describe('@effect-aws/lambda integration', () => {
	describe('with HttpApiProblemDetail middleware', () => {
		it('returns normal JSON for a successful POST', async () => {
			const result = await invoke(handlerWithMiddleware, 'POST', '/items', {
				name: 'Widget',
				quantity: 5,
			})

			expect(result.statusCode).toBe(201)
			expect(result.body).toMatchObject({ id: 1, name: 'Widget' })
		})

		it('returns problem+json for a declared NotFound error', async () => {
			const result = await invoke(handlerWithMiddleware, 'GET', '/items/999')

			expect(result.statusCode).toBe(404)
			expect(result.contentType).toContain('application/problem+json')
			expect(result.body).toMatchObject({
				status: 404,
				title: 'Not Found',
				detail: 'Item with id 999 was not found',
			})
		})

		it('returns problem+json with RFC 9457 fields for declared errors', async () => {
			const result = await invoke(handlerWithMiddleware, 'GET', '/items/42')

			expect(result.statusCode).toBe(404)
			expect(result.body).toHaveProperty('type')
			expect(result.body).toHaveProperty('title')
			expect(result.body).toHaveProperty('status')
			expect(result.body).toHaveProperty('detail')
		})

		it('catches unhandled defects and returns 500 problem+json', async () => {
			const result = await invoke(handlerWithMiddleware, 'GET', '/items/crash')

			expect(result.statusCode).toBe(500)
			expect(result.contentType).toContain('application/problem+json')
			expect(result.body).toMatchObject({
				status: 500,
				title: 'Internal Server Error',
				detail: 'An unexpected error occurred',
			})
			expect(result.rawBody).not.toContain('Unexpected failure')
			expect(result.rawBody).not.toContain('stack')
		})

		it('rewrites schema validation failures to 400 problem+json', async () => {
			const result = await invoke(handlerWithMiddleware, 'POST', '/items', {
				bad: 'payload',
			})

			expect(result.statusCode).toBe(400)
			expect(result.contentType).toContain('application/problem+json')
			expect(result.body).toMatchObject({
				type: '/problems/schema-error',
				title: 'Bad Request',
				status: 400,
				detail: 'The request did not match the expected schema',
			})
		})

		it('rewrites missing required fields to 400 problem+json', async () => {
			const result = await invoke(handlerWithMiddleware, 'POST', '/items', {})

			expect(result.statusCode).toBe(400)
			expect(result.contentType).toContain('application/problem+json')
			expect(result.body).toMatchObject({
				status: 400,
				title: 'Bad Request',
			})
		})

		it('uses custom typePrefix when configured', async () => {
			const customHandler = LambdaHandler.fromHttpApi(
				Layer.mergeAll(ApiLive, HttpApiProblemDetail.middleware({ typePrefix: '/api/errors/' })),
			)
			const result = await invoke(customHandler, 'GET', '/items/crash')

			expect(result.statusCode).toBe(500)
			expect(result.body).toMatchObject({
				type: '/api/errors/internal-server-error',
			})
		})

		it('does not alter successful responses', async () => {
			const result = await invoke(handlerWithMiddleware, 'POST', '/items', {
				name: 'Test',
				quantity: 1,
			})

			expect(result.statusCode).toBe(201)
			expect(result.contentType).not.toContain('application/problem+json')
		})

		it('does not relabel non-problem JSON errors as problem+json', async () => {
			const result = await invoke(handlerWithMiddleware, 'GET', '/items/json-conflict')

			expect(result.statusCode).toBe(409)
			expect(result.contentType ?? '').toContain('application/json')
			expect(result.contentType ?? '').not.toContain('application/problem+json')
			expect(result.body).toMatchObject({
				message: 'Version conflict',
			})
		})
	})

	describe('without HttpApiProblemDetail middleware (baseline)', () => {
		it('returns normal JSON for a successful POST', async () => {
			const result = await invoke(handlerWithoutMiddleware, 'POST', '/items', {
				name: 'Widget',
				quantity: 5,
			})

			expect(result.statusCode).toBe(201)
			expect(result.body).toMatchObject({ id: 1, name: 'Widget' })
		})

		it('still returns the RFC 9457 body for declared errors without middleware', async () => {
			const result = await invoke(handlerWithoutMiddleware, 'GET', '/items/999')

			expect(result.statusCode).toBe(404)
			expect(result.contentType ?? '').toContain('application/json')
			expect(result.body).toMatchObject({
				type: 'about:blank',
				title: 'Not Found',
				status: 404,
				detail: 'Item with id 999 was not found',
			})
		})

		it('does NOT catch defects as problem+json (no middleware safety net)', async () => {
			const result = await invoke(handlerWithoutMiddleware, 'GET', '/items/crash')

			expect(result.statusCode).toBe(500)
			expect(result.contentType ?? '').not.toContain('application/problem+json')
		})

		it('leaves validation failures in the framework default 400 form', async () => {
			const result = await invoke(handlerWithoutMiddleware, 'POST', '/items', {
				bad: 'payload',
			})

			expect(result.statusCode).toBe(400)
			expect(result.contentType ?? '').not.toContain('application/problem+json')
		})
	})

	describe('middleware value comparison (with vs without)', () => {
		it('middleware adds structured defect handling and validation rewriting', async () => {
			const withMw = await invoke(handlerWithMiddleware, 'GET', '/items/crash')
			const withoutMw = await invoke(handlerWithoutMiddleware, 'GET', '/items/crash')
			const withValidation = await invoke(handlerWithMiddleware, 'POST', '/items', {
				bad: 'payload',
			})
			const withoutValidation = await invoke(handlerWithoutMiddleware, 'POST', '/items', {
				bad: 'payload',
			})

			expect(withMw.statusCode).toBe(500)
			expect(withoutMw.statusCode).toBe(500)
			expect(withValidation.statusCode).toBe(400)
			expect(withoutValidation.statusCode).toBe(400)

			expect(withMw.body).toMatchObject({
				type: expect.any(String),
				title: 'Internal Server Error',
				status: 500,
				detail: 'An unexpected error occurred',
			})
			expect(withValidation.contentType).toContain('application/problem+json')
			if (withoutMw.body) {
				expect(withoutMw.body).not.toHaveProperty('title')
			}
			expect(withoutValidation.contentType ?? '').not.toContain('application/problem+json')
		})
	})
})
