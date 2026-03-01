import { beforeEach, describe, expect, it, vi } from '@effect/vitest'
import {
	Cause,
	Config,
	Duration,
	Effect,
	Exit,
	Layer,
	ManagedRuntime,
	Redacted,
	Schema,
	ServiceMap,
} from 'effect'
import { FetchHttpClient, HttpClientResponse } from 'effect/unstable/http'
import * as OAuthClient from '../src/effect-oauth-client'

const FooSchema = Schema.Struct({ foo: Schema.String })

class OAuthHttpClient extends ServiceMap.Service<OAuthHttpClient, OAuthClient.Client>()(
	'test/OAuthHttpClient',
) {}

const createProgram = (credentials: OAuthClient.Credentials) =>
	Effect.gen(function* () {
		const client = yield* OAuthClient.make(credentials)
		return yield* client
			.get('https://api.example.com/secret-foo')
			.pipe(Effect.flatMap(HttpClientResponse.schemaBodyJson(FooSchema)), Effect.scoped)
	})

const provideFetch = <A, E, R>(
	effect: Effect.Effect<A, E, R>,
	fetchImpl: typeof globalThis.fetch,
) =>
	effect.pipe(
		Effect.provide(
			FetchHttpClient.layer.pipe(Layer.provide(Layer.succeed(FetchHttpClient.Fetch, fetchImpl))),
		),
	)

const makeFetchLayer = (fetchImpl: typeof globalThis.fetch) =>
	FetchHttpClient.layer.pipe(Layer.provide(Layer.succeed(FetchHttpClient.Fetch, fetchImpl)))

const makeOAuthLayer = (credentials: OAuthClient.Credentials, fetchImpl: typeof globalThis.fetch) =>
	Layer.effect(OAuthHttpClient)(OAuthClient.make(credentials)).pipe(
		Layer.provide(makeFetchLayer(fetchImpl)),
	)

describe('OAuthClient', () => {
	const fetch: ReturnType<typeof vi.fn> = vi.fn()

	const baseCredentials: OAuthClient.Credentials = {
		clientId: 'id123',
		clientSecret: Redacted.make('secret'),
		tokenUrl: 'https://api.example.com/token',
	}

	beforeEach(() => {
		vi.clearAllMocks()
		fetch.mockReset()
		fetch.mockImplementation(async (url: URL) => {
			if (url.href.includes('token')) {
				return new Response(
					JSON.stringify({
						access_token: 'test',
						expires_in: 3600,
						token_type: 'Bearer',
					}),
					{ status: 200 },
				)
			}
			return new Response(JSON.stringify({ foo: 'secretFoo' }), { status: 200 })
		})
	})

	it('should only call the token endpoint once for repeated requests', async () => {
		const runtime = ManagedRuntime.make(makeOAuthLayer(baseCredentials, fetch))
		const request = OAuthHttpClient.use((client) =>
			client
				.get('https://api.example.com/secret-foo')
				.pipe(Effect.flatMap(HttpClientResponse.schemaBodyJson(FooSchema)), Effect.scoped),
		)

		expect(fetch.mock.calls.length).toBe(0)
		const res1 = await runtime.runPromise(request)
		const res2 = await runtime.runPromise(request)

		expect(res1.foo).toBe('secretFoo')
		expect(res2.foo).toBe('secretFoo')
		expect(fetch.mock.calls.filter((c) => c[0].href.includes('token')).length).toBe(1)
		expect(fetch.mock.calls.filter((c) => c[0].href.includes('secret-foo')).length).toBe(2)

		await runtime.dispose()
	})

	it('should refresh token when cache ttl elapses', async () => {
		const runtime = ManagedRuntime.make(
			makeOAuthLayer({ ...baseCredentials, ttl: Duration.millis(1) }, fetch),
		)
		const request = OAuthHttpClient.use((client) =>
			client
				.get('https://api.example.com/secret-foo')
				.pipe(Effect.flatMap(HttpClientResponse.schemaBodyJson(FooSchema)), Effect.scoped),
		)

		await runtime.runPromise(request)
		await new Promise((resolve) => setTimeout(resolve, 10))
		await runtime.runPromise(request)

		expect(fetch.mock.calls.filter((c) => c[0].href.includes('token')).length).toBe(2)
		expect(fetch.mock.calls.filter((c) => c[0].href.includes('secret-foo')).length).toBe(2)

		await runtime.dispose()
	})

	it('should fail with AuthorizationError on 401', async () => {
		fetch.mockImplementation(async (url: URL) => {
			if (url.href.includes('token')) {
				return new Response(
					JSON.stringify({
						access_token: 'test',
						expires_in: 3600,
						token_type: 'Bearer',
					}),
					{ status: 200 },
				)
			}
			return new Response('Unauthorized', { status: 401 })
		})

		const exit = await Effect.runPromiseExit(provideFetch(createProgram(baseCredentials), fetch))
		expect(Exit.isFailure(exit)).toBe(true)

		if (Exit.isFailure(exit)) {
			const failReasons = exit.cause.reasons.filter(Cause.isFailReason)
			expect(failReasons.length).toBeGreaterThan(0)
			const firstError = failReasons[0]?.error
			expect(OAuthClient.isAuthorizationError(firstError)).toBe(true)
			if (OAuthClient.isAuthorizationError(firstError)) {
				expect(firstError.code).toBe('unauthorized')
			}
		}
	})

	it('isAuthorizationError should correctly identify AuthorizationError instances', () => {
		const error = new OAuthClient.AuthorizationError({
			message: 'Some error',
			code: 'client_error',
		})

		const notError = { message: 'Other', code: 'client_error' }
		const anotherError = new Error('Not an auth error')

		expect(OAuthClient.isAuthorizationError(error)).toBe(true)
		expect(OAuthClient.isAuthorizationError(notError)).toBe(false)
		expect(OAuthClient.isAuthorizationError(anotherError)).toBe(false)
	})

	it('should prepend baseUrl to outgoing requests', async () => {
		const program = Effect.gen(function* () {
			const client = yield* OAuthClient.make({
				...baseCredentials,
				baseUrl: 'https://api.example.com',
			})
			return yield* client
				.get('/secret-foo')
				.pipe(Effect.flatMap(HttpClientResponse.schemaBodyJson(FooSchema)), Effect.scoped)
		})

		const result = await Effect.runPromise(provideFetch(program, fetch))
		expect(result.foo).toBe('secretFoo')

		const apiCalls = fetch.mock.calls.filter((c) => !(c[0] as URL).href.includes('token'))
		expect(apiCalls.length).toBe(1)
		expect(apiCalls[0][0].href).toContain('https://api.example.com/secret-foo')
	})

	it('makeFromConfig should resolve Config values and create an authenticated client', async () => {
		const program = Effect.gen(function* () {
			const client = yield* OAuthClient.makeFromConfig({
				clientId: Config.succeed('id123'),
				clientSecret: Config.succeed(Redacted.make('secret')),
				tokenUrl: Config.succeed('https://api.example.com/token'),
				baseUrl: Config.succeed('https://api.example.com'),
				scope: Config.succeed('read:foo'),
			})
			return yield* client
				.get('/secret-foo')
				.pipe(Effect.flatMap(HttpClientResponse.schemaBodyJson(FooSchema)), Effect.scoped)
		})

		const result = await Effect.runPromise(provideFetch(program, fetch))
		expect(result.foo).toBe('secretFoo')

		const tokenCalls = fetch.mock.calls.filter((c) => (c[0] as URL).href.includes('token'))
		expect(tokenCalls.length).toBe(1)

		const requestInit = tokenCalls[0]?.[1] as RequestInit | undefined
		const body = requestInit?.body as Uint8Array | undefined
		const params = Object.fromEntries(
			new URLSearchParams(new TextDecoder('utf-8').decode(body ?? new Uint8Array())),
		)
		expect(params.scope).toBe('read:foo')
	})

	it('layer should provide OAuthHttpClient from static credentials', async () => {
		const oauthLayer = OAuthClient.layer({
			...baseCredentials,
			baseUrl: 'https://api.example.com',
		}).pipe(Layer.provide(makeFetchLayer(fetch)))

		const program = OAuthClient.OAuthHttpClient.use((client) =>
			client
				.get('/secret-foo')
				.pipe(Effect.flatMap(HttpClientResponse.schemaBodyJson(FooSchema)), Effect.scoped),
		)

		const result = await Effect.runPromise(program.pipe(Effect.provide(oauthLayer)))
		expect(result.foo).toBe('secretFoo')
		expect(fetch.mock.calls.filter((c) => (c[0] as URL).href.includes('token')).length).toBe(1)
	})

	it('layerFromConfig should provide OAuthHttpClient from Config values', async () => {
		const oauthLayer = OAuthClient.layerFromConfig({
			clientId: Config.succeed('id123'),
			clientSecret: Config.succeed(Redacted.make('secret')),
			tokenUrl: Config.succeed('https://api.example.com/token'),
			baseUrl: Config.succeed('https://api.example.com'),
		}).pipe(Layer.provide(makeFetchLayer(fetch)))

		const program = OAuthClient.OAuthHttpClient.use((client) =>
			client
				.get('/secret-foo')
				.pipe(Effect.flatMap(HttpClientResponse.schemaBodyJson(FooSchema)), Effect.scoped),
		)

		const result = await Effect.runPromise(program.pipe(Effect.provide(oauthLayer)))
		expect(result.foo).toBe('secretFoo')
		expect(fetch.mock.calls.filter((c) => (c[0] as URL).href.includes('token')).length).toBe(1)
	})

	it('should only send scope and audience if they are provided', async () => {
		await Effect.runPromiseExit(provideFetch(createProgram(baseCredentials), fetch))

		const requestInit = fetch.mock.calls[0]?.[1] as RequestInit | undefined
		const body = requestInit?.body as Uint8Array | undefined
		const params = Object.fromEntries(
			new URLSearchParams(new TextDecoder('utf-8').decode(body ?? new Uint8Array())),
		)

		expect(params.grant_type).toBe('client_credentials')
		expect(params.scope).toBeUndefined()
		expect(params.audience).toBeUndefined()
	})

	it('should invalidate token and retry once on 401, succeeding with a fresh token', async () => {
		let apiCallCount = 0
		fetch.mockImplementation(async (url: URL) => {
			if (url.href.includes('token')) {
				return new Response(
					JSON.stringify({
						access_token: 'test',
						expires_in: 3600,
						token_type: 'Bearer',
					}),
					{ status: 200 },
				)
			}
			apiCallCount++
			if (apiCallCount === 1) {
				return new Response('Unauthorized', { status: 401 })
			}
			return new Response(JSON.stringify({ foo: 'secretFoo' }), { status: 200 })
		})

		const result = await Effect.runPromise(provideFetch(createProgram(baseCredentials), fetch))
		expect(result.foo).toBe('secretFoo')
		expect(apiCallCount).toBe(2)
	})

	it('should not retry more than once on persistent 401', async () => {
		let apiCallCount = 0
		fetch.mockImplementation(async (url: URL) => {
			if (url.href.includes('token')) {
				return new Response(
					JSON.stringify({
						access_token: 'test',
						expires_in: 3600,
						token_type: 'Bearer',
					}),
					{ status: 200 },
				)
			}
			apiCallCount++
			return new Response('Unauthorized', { status: 401 })
		})

		const exit = await Effect.runPromiseExit(provideFetch(createProgram(baseCredentials), fetch))
		expect(Exit.isFailure(exit)).toBe(true)

		if (Exit.isFailure(exit)) {
			const failReasons = exit.cause.reasons.filter(Cause.isFailReason)
			expect(failReasons.length).toBeGreaterThan(0)
			const firstError = failReasons[0]?.error
			expect(OAuthClient.isAuthorizationError(firstError)).toBe(true)
			if (OAuthClient.isAuthorizationError(firstError)) {
				expect(firstError.code).toBe('unauthorized')
			}
		}

		expect(apiCallCount).toBe(2)
	})

	it('should fail with credentials_error when token response is malformed and not retry', async () => {
		let tokenCallCount = 0
		fetch.mockImplementation(async (url: URL) => {
			if (url.href.includes('token')) {
				tokenCallCount++
				return new Response(JSON.stringify({ error: 'invalid_client' }), { status: 400 })
			}
			return new Response(JSON.stringify({ foo: 'secretFoo' }), { status: 200 })
		})

		const exit = await Effect.runPromiseExit(provideFetch(createProgram(baseCredentials), fetch))
		expect(Exit.isFailure(exit)).toBe(true)

		if (Exit.isFailure(exit)) {
			const failReasons = exit.cause.reasons.filter(Cause.isFailReason)
			expect(failReasons.length).toBeGreaterThan(0)
			const firstError = failReasons[0]?.error
			expect(OAuthClient.isAuthorizationError(firstError)).toBe(true)
			if (OAuthClient.isAuthorizationError(firstError)) {
				expect(firstError.code).toBe('credentials_error')
			}
		}

		expect(tokenCallCount).toBe(1)
	})

	it('should fail with client_error after exhausting retries on persistent network failure', async () => {
		let tokenCallCount = 0
		fetch.mockImplementation(async (url: URL) => {
			if (url.href.includes('token')) {
				tokenCallCount++
				throw new Error('Network error')
			}
			return new Response(JSON.stringify({ foo: 'secretFoo' }), { status: 200 })
		})

		const exit = await Effect.runPromiseExit(provideFetch(createProgram(baseCredentials), fetch))
		expect(Exit.isFailure(exit)).toBe(true)

		if (Exit.isFailure(exit)) {
			const failReasons = exit.cause.reasons.filter(Cause.isFailReason)
			expect(failReasons.length).toBeGreaterThan(0)
			const firstError = failReasons[0]?.error
			expect(OAuthClient.isAuthorizationError(firstError)).toBe(true)
			if (OAuthClient.isAuthorizationError(firstError)) {
				expect(firstError.code).toBe('client_error')
			}
		}

		expect(tokenCallCount).toBe(3)
	})

	it('should recover from transient token endpoint failures', async () => {
		let tokenCallCount = 0
		fetch.mockImplementation(async (url: URL) => {
			if (url.href.includes('token')) {
				tokenCallCount++
				if (tokenCallCount <= 2) {
					throw new Error('Connection refused')
				}
				return new Response(
					JSON.stringify({
						access_token: 'test',
						expires_in: 3600,
						token_type: 'Bearer',
					}),
					{ status: 200 },
				)
			}
			return new Response(JSON.stringify({ foo: 'secretFoo' }), { status: 200 })
		})

		const result = await Effect.runPromise(provideFetch(createProgram(baseCredentials), fetch))
		expect(result.foo).toBe('secretFoo')
		expect(tokenCallCount).toBe(3)
	})

	it('should retry on 429 rate limiting from token endpoint', async () => {
		let tokenCallCount = 0
		fetch.mockImplementation(async (url: URL) => {
			if (url.href.includes('token')) {
				tokenCallCount++
				if (tokenCallCount <= 2) {
					return new Response(JSON.stringify({ error: 'rate_limit_exceeded' }), { status: 429 })
				}
				return new Response(
					JSON.stringify({
						access_token: 'test',
						expires_in: 3600,
						token_type: 'Bearer',
					}),
					{ status: 200 },
				)
			}
			return new Response(JSON.stringify({ foo: 'secretFoo' }), { status: 200 })
		})

		const result = await Effect.runPromise(provideFetch(createProgram(baseCredentials), fetch))
		expect(result.foo).toBe('secretFoo')
		expect(tokenCallCount).toBe(3)
	})

	it('should retry on 502 from token endpoint', async () => {
		let tokenCallCount = 0
		fetch.mockImplementation(async (url: URL) => {
			if (url.href.includes('token')) {
				tokenCallCount++
				if (tokenCallCount <= 1) {
					return new Response('<html>Bad Gateway</html>', { status: 502 })
				}
				return new Response(
					JSON.stringify({
						access_token: 'test',
						expires_in: 3600,
						token_type: 'Bearer',
					}),
					{ status: 200 },
				)
			}
			return new Response(JSON.stringify({ foo: 'secretFoo' }), { status: 200 })
		})

		const result = await Effect.runPromise(provideFetch(createProgram(baseCredentials), fetch))
		expect(result.foo).toBe('secretFoo')
		expect(tokenCallCount).toBe(2)
	})

	it('should not retry on 400 from token endpoint', async () => {
		let tokenCallCount = 0
		fetch.mockImplementation(async (url: URL) => {
			if (url.href.includes('token')) {
				tokenCallCount++
				return new Response(
					JSON.stringify({ error: 'invalid_client', error_description: 'Bad credentials' }),
					{ status: 400 },
				)
			}
			return new Response(JSON.stringify({ foo: 'secretFoo' }), { status: 200 })
		})

		const exit = await Effect.runPromiseExit(provideFetch(createProgram(baseCredentials), fetch))
		expect(Exit.isFailure(exit)).toBe(true)

		if (Exit.isFailure(exit)) {
			const failReasons = exit.cause.reasons.filter(Cause.isFailReason)
			const firstError = failReasons[0]?.error
			expect(OAuthClient.isAuthorizationError(firstError)).toBe(true)
			if (OAuthClient.isAuthorizationError(firstError)) {
				expect(firstError.code).toBe('credentials_error')
			}
		}

		expect(tokenCallCount).toBe(1)
	})
})
