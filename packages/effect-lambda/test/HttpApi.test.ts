import { describe, expect, it } from '@effect/vitest'
import type {
	APIGatewayProxyEventV2 as AwsAPIGatewayProxyEventV2,
	Context as AwsContext,
} from 'aws-lambda'
import { Effect, Layer, Schema } from 'effect'
import {
	NormalizedHeaders,
	schemaBodyJson,
	schemaPathParams,
	toLambdaHandler,
} from '../src/HttpApi'

const mockContext = {} as AwsContext

const createEvent = (
	body?: string,
	isBase64Encoded = false,
	headers: { [key: string]: string | undefined } = {},
): AwsAPIGatewayProxyEventV2 => ({
	version: '2.0',
	routeKey: '$default',
	rawPath: '/',
	rawQueryString: '',
	cookies: [],
	headers,
	queryStringParameters: undefined,
	requestContext: {
		accountId: '123456789012',
		apiId: 'api-id',
		domainName: 'example.com',
		domainPrefix: 'example',
		http: {
			method: 'POST',
			path: '/',
			protocol: 'HTTP/1.1',
			sourceIp: '127.0.0.1',
			userAgent: 'vitest',
		},
		requestId: 'id',
		routeKey: '$default',
		stage: '$default',
		time: 'time',
		timeEpoch: Date.now(),
	},
	body,
	pathParameters: undefined,
	isBase64Encoded,
	stageVariables: undefined,
})

describe('HttpApi', () => {
	it('should normalize headers', async () => {
		const handler = NormalizedHeaders.pipe(
			Effect.map((headers) => ({
				statusCode: 200,
				body: JSON.stringify(headers),
			})),
			(eff) => toLambdaHandler(eff),
		)({ layer: Layer.empty })

		const event = createEvent(undefined, false, {
			'Content-Type': 'application/json',
			Foo: 'Bar',
		})

		const result = await handler(event, mockContext, () => {})

		expect(result).toEqual({
			statusCode: 200,
			body: JSON.stringify({ 'content-type': 'application/json', foo: 'Bar' }),
		})
	})

	it('should parse JSON body', async () => {
		const schema = Schema.Struct({ foo: Schema.String })
		const handler = schemaBodyJson(schema).pipe(
			Effect.map((body) => ({ statusCode: 200, body: JSON.stringify(body) })),
			Effect.orDie,
			(eff) => toLambdaHandler(eff),
		)({ layer: Layer.empty })

		const body = { foo: 'bar' }
		const event = createEvent(JSON.stringify(body), false, {
			'Content-Type': 'application/json',
		})
		const result = await handler(event, mockContext, () => {})

		expect(result).toEqual({ statusCode: 200, body: JSON.stringify(body) })
	})

	it('should decode base64 JSON body', async () => {
		const schema = Schema.Struct({ msg: Schema.String })
		const handler = schemaBodyJson(schema).pipe(
			Effect.map((body) => ({ statusCode: 200, body: JSON.stringify(body) })),
			Effect.orDie,
			(eff) => toLambdaHandler(eff),
		)({ layer: Layer.empty })

		const base64Body = Buffer.from(JSON.stringify({ msg: 'hello' })).toString(
			'base64',
		)
		const event = createEvent(base64Body, true, {
			'content-type': 'application/json',
		})
		const result = await handler(event, mockContext, () => {})

		expect(result).toEqual({
			statusCode: 200,
			body: JSON.stringify({ msg: 'hello' }),
		})
	})

	it('should read path params', async () => {
		const PathParams = Schema.Struct({ id: Schema.String })
		const handler = schemaPathParams(PathParams).pipe(
			Effect.map(({ id }) => ({ statusCode: 200, body: id })),
			Effect.orDie,
			(eff) => toLambdaHandler(eff),
		)({ layer: Layer.empty })

		const event = { ...createEvent(), pathParameters: { id: '123' } }
		const result = await handler(event, mockContext, () => {})

		expect(result).toEqual({ statusCode: 200, body: '123' })
	})
})
