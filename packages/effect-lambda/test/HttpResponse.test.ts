import { describe, expect, it } from '@effect/vitest'
import { Effect, Schema as S } from 'effect'
import {
	badRequestFromParseError,
	clientError,
	created,
	type HttpResponse,
	jsonResponse,
	noContent,
	ok,
	problem,
	redirect,
	serverError,
} from '../src/HttpResponse'

const parseBody = (resp: HttpResponse) => JSON.parse(resp.body ?? '{}')

describe('HttpResponse.jsonResponse', () => {
	it('encodes body using schema and sets default content-type', async () => {
		const res = await jsonResponse({
			statusCode: 200,
			body: { a: 1 },
		}).pipe(Effect.runPromise)

		expect(res.statusCode).toBe(200)
		expect(res.headers?.['content-type']).toBe('application/json')
		expect(res.body).toBe(JSON.stringify({ a: 1 }))
	})

	it('overrides non-JSON content-type to application/json', async () => {
		const res = await jsonResponse({
			statusCode: 200,
			body: { a: 1 },
			headers: { 'Content-Type': 'text/plain' },
		}).pipe(Effect.runPromise)

		expect(res.headers?.['content-type']).toBe('application/json')
	})

	it('preserves provided JSON content-type and lowercases header keys', async () => {
		const res = await jsonResponse({
			statusCode: 200,
			body: { a: 1 },
			headers: { 'X-Custom': 'ok', 'Content-Type': 'application/vnd.api+json' },
		}).pipe(Effect.runPromise)

		expect(res.headers).toEqual({
			'x-custom': 'ok',
			'content-type': 'application/vnd.api+json',
		})
	})

	it('applies schema encoding (e.g. NumberFromString)', async () => {
		const schema = S.Struct({ n: S.NumberFromString })
		const res = await jsonResponse({
			statusCode: 200,
			body: { n: 123 },
			schema,
		}).pipe(Effect.runPromise)

		expect(parseBody(res)).toEqual({ n: '123' })
	})

	it.effect('dies if schema encoding fails', () =>
		Effect.gen(function* () {
			yield* jsonResponse({
				statusCode: 200,
				body: { n: 'not-a-number' as unknown as number },
				schema: S.Struct({ n: S.NumberFromString }),
			}).pipe(
				Effect.catchAllDefect((e) => {
					expect(e instanceof Error && e.message).toContain('[jsonResponse]: Failed to encode body')
					return Effect.void
				}),
			)
		}),
	)
})

describe('HttpResponse.ok', () => {
	it('returns 200 and JSON string body by default', async () => {
		const res = await ok({ statusCode: 200, body: { a: 1 } }).pipe(Effect.runPromise)
		expect(res.statusCode).toBe(200)
		expect(parseBody(res)).toEqual({ a: 1 })
		expect(res.headers?.['content-type']).toBe('application/json')
	})

	it('respects provided JSON content-type header', async () => {
		const res = await ok({
			statusCode: 200,
			body: { a: 1 },
			headers: { 'Content-Type': 'application/json' },
		}).pipe(Effect.runPromise)
		expect(res.headers?.['content-type']).toBe('application/json')
	})
})

describe('HttpResponse.created', () => {
	it('returns 201 and includes Location header when provided', async () => {
		const res = await created({ body: { id: 1 }, location: '/foo/1' }).pipe(Effect.runPromise)
		expect(res.statusCode).toBe(201)
		expect(res.headers?.location).toBe('/foo/1')
		expect(parseBody(res)).toEqual({ id: 1 })
	})

	it('merges provided headers with Location', async () => {
		const res = await created({
			body: { id: 1 },
			location: '/foo/1',
			headers: { 'X-Req': '123' },
		}).pipe(Effect.runPromise)
		expect(res.headers).toEqual({
			'x-req': '123',
			location: '/foo/1',
			'content-type': 'application/json',
		})
	})
})

describe('HttpResponse.noContent', () => {
	it('returns 204 with provided headers and no body', () => {
		const res = noContent({ 'X-Trace': '1' })
		expect(res.statusCode).toBe(204)
		expect(res.headers).toEqual({ 'x-trace': '1' })
		expect(res.body).toBe('')
	})
})

describe('HttpResponse.redirect', () => {
	it('returns 302 with Location header by default', () => {
		const res = redirect({ to: 'https://example.com', statusCode: 302 })
		expect(res.statusCode).toBe(302)
		expect(res.headers?.location).toBe('https://example.com')
	})

	it('supports custom status and merges headers', () => {
		const res = redirect({ to: '/new', statusCode: 301, headers: { 'X-Req': '1' } })
		expect(res.statusCode).toBe(301)
		expect(res.headers).toEqual({ 'x-req': '1', location: '/new' })
	})
})

describe('HttpResponse.badRequestFromParseError', () => {
	const makeParseError = async () =>
		await S.decode(S.Struct({ n: S.Number }))({ n: 'not-a-number' as unknown as number }).pipe(
			Effect.flip,
			Effect.runPromise,
		)

	it('returns 400 problem+json with formatted errors', async () => {
		const error = await makeParseError()
		const res = await badRequestFromParseError(error).pipe(Effect.runPromise)
		expect(res.statusCode).toBe(400)
		expect(res.headers?.['content-type']).toBe('application/problem+json')
		const body = parseBody(res)
		expect(body.status).toBe(400)
		expect(body.title).toBe('Bad Request')
		expect(Array.isArray(body.errors)).toBe(true)
		expect(body.errors.length).toBeGreaterThan(0)
	})

	it('allows overriding status (e.g. 422) and adds optional fields', async () => {
		const error = await makeParseError()
		const res = await badRequestFromParseError(error, {
			statusCode: 422,
			type: 'https://example.com/problems/validation-error',
			instance: '/request/123',
			detail: 'Invalid data',
			headers: { 'X-Trace': 'abc' },
		}).pipe(Effect.runPromise)

		expect(res.statusCode).toBe(422)
		const body = parseBody(res)
		expect(body.status).toBe(422)
		expect(body.title).toBe('Unprocessable Entity')
		expect(body.type).toBe('https://example.com/problems/validation-error')
		expect(body.instance).toBe('/request/123')
		expect(body.detail).toBe('Invalid data')
		expect(res.headers?.['x-trace']).toBe('abc')
	})
})

describe('HttpResponse.problem', () => {
	it('builds problem+json with derived title', async () => {
		const res = await problem({ status: 404, detail: 'Not here' }).pipe(Effect.runPromise)
		const body = parseBody(res)
		expect(res.statusCode).toBe(404)
		expect(res.headers?.['content-type']).toBe('application/problem+json')
		expect(body.title).toBe('Not Found')
		expect(body.detail).toBe('Not here')
	})
})

describe('HttpResponse.clientError', () => {
	it('defaults to 400 problem+json', async () => {
		const res = await clientError().pipe(Effect.runPromise)
		const body = parseBody(res)
		expect(res.statusCode).toBe(400)
		expect(res.headers?.['content-type']).toBe('application/problem+json')
		expect(body.status).toBe(400)
		expect(body.title).toBe('Bad Request')
	})

	it('respects overrides and includes extensions', async () => {
		const res = await clientError({
			statusCode: 401,
			detail: 'Auth required',
			type: 'about:blank',
			instance: '/secure',
			extensions: { reason: 'missing_token' },
			headers: { 'X-Trace': '1' },
		}).pipe(Effect.runPromise)

		const body = parseBody(res)
		expect(res.statusCode).toBe(401)
		expect(res.headers?.['x-trace']).toBe('1')
		expect(body.title).toBe('Unauthorized')
		expect(body.detail).toBe('Auth required')
		expect(body.type).toBe('about:blank')
		expect(body.instance).toBe('/secure')
		expect(body.reason).toEqual('missing_token')
	})
})

describe('HttpResponse.serverError', () => {
	it('defaults to 500 problem+json', async () => {
		const res = await serverError().pipe(Effect.runPromise)
		const body = parseBody(res)
		expect(res.statusCode).toBe(500)
		expect(res.headers?.['content-type']).toBe('application/problem+json')
		expect(body.title).toBe('Internal Server Error')
	})

	it('respects overrides', async () => {
		const res = await serverError({
			statusCode: 503,
			detail: 'Downstream unavailable',
			headers: { 'X-Id': '7' },
			instance: '/svc',
			type: 'about:blank',
			extensions: { svc: 'db' },
		}).pipe(Effect.runPromise)

		const body = parseBody(res)
		expect(res.statusCode).toBe(503)
		expect(res.headers?.['x-id']).toBe('7')
		expect(body.title).toBe('Service Unavailable')
		expect(body.detail).toBe('Downstream unavailable')
		expect(body.instance).toBe('/svc')
		expect(body.type).toBe('about:blank')
		expect(body.svc).toEqual('db')
	})
})
