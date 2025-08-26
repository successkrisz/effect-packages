import {
	FetchHttpClient,
	type HttpClient,
	HttpClientResponse,
} from '@effect/platform'
import { beforeEach, describe, expect, it, vi } from '@effect/vitest'
import {
	Context,
	Duration,
	Effect,
	Exit,
	Layer,
	ManagedRuntime,
	Redacted,
	Schema,
	TestClock,
	TestContext,
} from 'effect'
import type { ConfigError } from 'effect/ConfigError'
import type { ParseError } from 'effect/ParseResult'
import * as OAuthClient from '../src/effect-oauth-client'

// ===== API Schemas =====

const FooSchema = Schema.Struct({
	foo: Schema.String,
})

// ===== Service =====

const makeService1 = (creds: OAuthClient.Credentials) =>
	Effect.gen(function* () {
		const client = yield* OAuthClient.make(creds)
		const getSecretFoo = () =>
			client
				.get('https://api.example.com/secret-foo')
				.pipe(
					Effect.flatMap(HttpClientResponse.schemaBodyJson(FooSchema)),
					Effect.scoped,
				)

		return {
			getSecretFoo,
		}
	})

class SomeService1 extends Context.Tag('@ballatech/SomeService1')<
	SomeService1,
	Effect.Effect.Success<ReturnType<typeof makeService1>>
>() {}

const SomeService1Layer = Layer.effect(
	SomeService1,
	makeService1({
		clientId: 'id123',
		clientSecret: Redacted.make('secret'),
		tokenUrl: 'https://api.example.com/token',
	}),
)

describe('OAuthClient', () => {
	let rt: ManagedRuntime.ManagedRuntime<
		HttpClient.HttpClient | SomeService1,
		ParseError | ConfigError
	>
	const fetch: ReturnType<typeof vi.fn> = vi.fn()
	beforeEach(() => {
		vi.clearAllMocks()
		fetch.mockClear()
		fetch.mockReset()
		const FetchTest = Layer.succeed(FetchHttpClient.Fetch, fetch)
		const TestLayer = FetchHttpClient.layer.pipe(Layer.provide(FetchTest))
		rt = ManagedRuntime.make(
			SomeService1Layer.pipe(
				Layer.provideMerge(TestLayer),
				Layer.provide(TestContext.TestContext),
			),
		)
	})

	it('Should only call the token endpoint once', async () => {
		fetch.mockImplementation(async (url) => {
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
			return new Response(JSON.stringify({ foo: 'secretFoo' }), {
				status: 200,
			})
		})

		const prog = Effect.gen(function* () {
			const service = yield* SomeService1
			const res = yield* service.getSecretFoo()
			yield* Effect.logInfo(res)
			return res
		})

		expect(fetch.mock.calls.length).toBe(0)
		const res1 = await rt.runPromise(prog)
		expect(res1.foo).toBe('secretFoo')
		const res2 = await rt.runPromise(prog)
		expect(res2.foo).toBe('secretFoo')

		expect(fetch.mock.calls.length).toBe(3)
		expect(
			fetch.mock.calls.filter((c) => c[0].href.includes('token')).length,
		).toBe(1)
		expect(
			fetch.mock.calls.filter((c) => c[0].href.includes('secret-foo')).length,
		).toBe(2)
		// console.log(
		//   "HTTP calls:",
		//   fetch.mock.calls.map((c) => c[0].href)
		// )
	})

	it('Should refresh expired token', async () => {
		fetch.mockImplementation(async (url) => {
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
			return new Response(JSON.stringify({ foo: 'secretFoo' }), {
				status: 200,
			})
		})

		const prog = Effect.gen(function* () {
			const service = yield* SomeService1
			yield* service.getSecretFoo()
			yield* TestClock.adjust(Duration.seconds(1000)) // 1000 seconds = 16 minutes 40 seconds
			yield* service.getSecretFoo()
			yield* TestClock.adjust(Duration.seconds(2600)) // 2600 seconds = 43 minutes
			yield* service.getSecretFoo()
			const res = yield* service.getSecretFoo()
			return res
		})

		const res1 = await rt.runPromise(
			prog.pipe(Effect.provide(TestContext.TestContext)),
		)
		expect(res1.foo).toBe('secretFoo')

		expect(fetch.mock.calls.length).toBe(6)
		expect(
			fetch.mock.calls.filter((c) => c[0].href.includes('token')).length,
		).toBe(2)
		expect(
			fetch.mock.calls.filter((c) => c[0].href.includes('secret-foo')).length,
		).toBe(4)
		// console.log(fetch.mock.calls.map((c) => c[0].href))
	})

	it('Should not retry http errors', async () => {
		// Simulate a non-401 HTTP error (e.g., 403 Forbidden)
		fetch.mockImplementation(async (url) => {
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
			return new Response('Not found', { status: 401 })
		})

		const prog = Effect.gen(function* () {
			const service = yield* SomeService1
			return yield* service.getSecretFoo()
		})

		const error = await rt.runPromiseExit(
			prog.pipe(Effect.provide(TestContext.TestContext)),
		)

		// Should only call token endpoint once and secret endpoint once
		expect(
			fetch.mock.calls.filter((c) => c[0].href.includes('token')).length,
		).toBe(1)
		expect(
			fetch.mock.calls.filter((c) => c[0].href.includes('secret-foo')).length,
		).toBe(1)

		expect(error._tag).toBe('Failure')
		expect(
			Exit.isFailure(error) &&
				error.cause._tag === 'Fail' &&
				error.cause.error._tag,
		).toBe('@ballatech/effect-oauth-client/AuthorizationError')
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
})
