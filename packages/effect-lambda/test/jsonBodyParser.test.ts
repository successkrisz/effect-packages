import { describe, expect, it } from '@effect/vitest'
import type { APIGatewayProxyEvent } from 'aws-lambda'
import { Effect, ParseResult } from 'effect'
import { jsonBodyParser } from '../src/internal/jsonBodyParser'

describe('jsonBodyParser', () => {
	const createEvent = (
		body: string | null,
		isBase64Encoded = false,
		headers: { [key: string]: string | undefined } = {},
	): APIGatewayProxyEvent => ({
		body,
		isBase64Encoded,
		headers,
		httpMethod: 'POST',
		path: '/',
		pathParameters: null,
		queryStringParameters: null,
		multiValueQueryStringParameters: null,
		stageVariables: null,
		requestContext: {} as unknown as APIGatewayProxyEvent['requestContext'],
		resource: '',
		multiValueHeaders: {},
	})

	it('should return the event if body is null', async () => {
		const event = createEvent(null)
		const result = await jsonBodyParser(event).pipe(Effect.runPromise)
		expect(result).toEqual(event)
	})

	it('should return the event if content-type is not application/json', async () => {
		const event = createEvent('{"key": "value"}', false, {
			'content-type': 'text/plain',
		})
		const result = await jsonBodyParser(event).pipe(Effect.runPromise)
		expect(result).toEqual(event)
	})

	it('should parse JSON body if content-type is application/json', async () => {
		const body = { key: 'value' }
		const event = createEvent(JSON.stringify(body), false, {
			'content-type': 'application/json',
		})
		const result = await jsonBodyParser(event).pipe(Effect.runPromise)
		expect(result.body).toEqual(body)
		expect(result.rawBody).toEqual(JSON.stringify(body))
	})

	it('should parse JSON body if content-type is application/vnd.api+json', async () => {
		const body = { key: 'value' }
		const event = createEvent(JSON.stringify(body), false, {
			'content-type': 'application/vnd.api+json',
		})
		const result = await jsonBodyParser(event).pipe(Effect.runPromise)
		expect(result.body).toEqual(body)
		expect(result.rawBody).toEqual(JSON.stringify(body))
	})

	it('should parse JSON body if content-type ends with +json', async () => {
		const body = { key: 'value' }
		const event = createEvent(JSON.stringify(body), false, {
			'content-type': 'application/json+json',
		})
		const result = await jsonBodyParser(event).pipe(Effect.runPromise)
		expect(result.body).toEqual(body)
		expect(result.rawBody).toEqual(JSON.stringify(body))
	})

	it('should decode base64 encoded JSON body', async () => {
		const body = { key: 'value' }
		const base64Body = Buffer.from(JSON.stringify(body)).toString('base64')
		const event = createEvent(base64Body, true, {
			'content-type': 'application/json',
		})
		const result = await jsonBodyParser(event).pipe(Effect.runPromise)
		expect(result.body).toEqual(body)
		expect(result.rawBody).toEqual(base64Body)
	})

	it('should fail with ParseError if JSON is invalid', async () => {
		const event = createEvent('invalid json', false, {
			'content-type': 'application/json',
		})
		await expect(
			jsonBodyParser(event).pipe(
				Effect.catchTag('ParseError', (e) => Effect.succeed(e)),
				Effect.runPromise,
			),
		).resolves.toBeInstanceOf(ParseResult.ParseError)
	})
})
