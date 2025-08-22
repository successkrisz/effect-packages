import { describe, expect, it } from '@effect/vitest'
import type { APIGatewayProxyEvent } from 'aws-lambda'
import { headerNormalizer } from '../src/internal/headerNormalizer'

describe('headerNormalizer', () => {
	const createEvent = (
		headers: { [key: string]: string | undefined } = {},
	): APIGatewayProxyEvent => ({
		body: null,
		isBase64Encoded: false,
		headers,
		httpMethod: 'GET',
		path: '/',
		pathParameters: null,
		queryStringParameters: null,
		multiValueQueryStringParameters: null,
		stageVariables: null,
		requestContext: {} as unknown as APIGatewayProxyEvent['requestContext'],
		resource: '',
		multiValueHeaders: {},
	})

	it('should normalize headers to lowercase', () => {
		const rawHeaders = { 'Content-Type': 'application/json' }
		const event = createEvent(rawHeaders)
		const normalizedEvent = headerNormalizer(event)

		expect(normalizedEvent.headers).toEqual({
			'content-type': 'application/json',
		})
		expect(normalizedEvent.rawHeaders).toEqual(rawHeaders)
	})

	it('should handle empty headers', () => {
		const event = createEvent()
		const normalizedEvent = headerNormalizer(event)

		expect(normalizedEvent.headers).toEqual({})
		expect(normalizedEvent.rawHeaders).toEqual({})
	})

	it('should preserve undefined header values', () => {
		const rawHeaders = { 'X-Custom-Header': undefined }
		const event = createEvent(rawHeaders)
		const normalizedEvent = headerNormalizer(event)

		expect(normalizedEvent.headers).toEqual({
			'x-custom-header': undefined,
		})
		expect(normalizedEvent.rawHeaders).toEqual(rawHeaders)
	})
})
