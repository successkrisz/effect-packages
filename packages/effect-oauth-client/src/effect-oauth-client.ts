import { Data, DateTime, Duration, Effect, Predicate, Redacted, Schema } from 'effect'
import { HttpClient, HttpClientRequest, HttpClientResponse } from 'effect/unstable/http'

/**
 * OAuth client utilities for obtaining and attaching client credentials tokens.
 */
export const AuthorizationErrorTypeId: unique symbol = Symbol.for(
	'@ballatech/effect-oauth-client/AuthorizationErrorTypeId',
)
export type AuthorizationErrorTypeId = typeof AuthorizationErrorTypeId

export const isAuthorizationError = (u: unknown): u is AuthorizationError =>
	Predicate.hasProperty(u, AuthorizationErrorTypeId)

/** Error type for OAuth authorization failures. */
export class AuthorizationError extends Data.TaggedError(
	'@ballatech/effect-oauth-client/AuthorizationError',
)<{
	readonly message: string
	readonly code: 'credentials_error' | 'client_error' | 'unauthorized'
}> {
	readonly [AuthorizationErrorTypeId] = AuthorizationErrorTypeId
}

/** Configuration required to obtain tokens via client credentials flow. */
export type Credentials = {
	clientId: string
	clientSecret: Redacted.Redacted<string>
	tokenUrl: string
	scope?: string
	audience?: string
	ttl?: Duration.Duration
	expiryBuffer?: Duration.Duration
}

type Token = {
	accessToken: string
	expiresIn: number
	expiresAt: DateTime.DateTime
}
/**
 * Build an HttpClient that automatically injects a bearer token.
 *
 * Tokens are fetched using the OAuth client credentials grant and cached according to
 * the ttl, with early refresh controlled by expiryBuffer.
 */
export const make = ({
	clientId,
	clientSecret,
	tokenUrl,
	scope,
	audience,
	ttl = Duration.seconds(3600),
	expiryBuffer = Duration.seconds(300),
}: Credentials) =>
	Effect.gen(function* () {
		const client = yield* HttpClient.HttpClient

		const tokenBody = {
			grant_type: 'client_credentials',
			...(scope ? { scope } : undefined),
			...(audience ? { audience } : undefined),
		}
		const tokenSchema = Schema.Struct({
			access_token: Schema.String,
			token_type: Schema.String,
			expires_in: Schema.Number,
		})

		const getNewCredentials = client
			.execute(
				HttpClientRequest.post(tokenUrl).pipe(
					HttpClientRequest.bodyUrlParams(tokenBody),
					HttpClientRequest.basicAuth(clientId, Redacted.value(clientSecret)),
					HttpClientRequest.setHeader('Content-Type', 'application/x-www-form-urlencoded'),
				),
			)
			.pipe(
				Effect.flatMap(HttpClientResponse.schemaBodyJson(tokenSchema)),
				Effect.map((response) => ({
					accessToken: response.access_token,
					expiresIn: response.expires_in,
				})),
				Effect.scoped,
				Effect.mapError(
					(error) =>
						new AuthorizationError({
							message: error instanceof Error ? error.message : 'Failed to fetch OAuth credentials',
							code:
								Predicate.hasProperty(error, '_tag') && error._tag === 'SchemaError'
									? 'credentials_error'
									: 'client_error',
						}),
				),
			)

		// Create a cached token effect that uses the token's actual expiry time for TTL
		const getToken = Effect.flatMap(getNewCredentials, (credentials) =>
			Effect.gen(function* () {
				const now = yield* DateTime.now
				const expiresAt = DateTime.add(now, {
					seconds: credentials.expiresIn - Duration.toSeconds(expiryBuffer),
				})
				return {
					...credentials,
					expiresAt,
				}
			}),
		)

		const [creds, invalidateToken]: readonly [
			Effect.Effect<Token, AuthorizationError>,
			Effect.Effect<void>,
		] = yield* Effect.cachedInvalidateWithTTL(getToken, ttl)

		return client.pipe(
			HttpClient.mapRequestInput(HttpClientRequest.acceptJson),
			HttpClient.mapRequestInputEffect((request) =>
				Effect.gen(function* () {
					const { accessToken, expiresAt } = yield* creds
					const now = yield* DateTime.now
					if (DateTime.isGreaterThan(now, expiresAt)) {
						yield* invalidateToken
						const refreshed = yield* creds
						if (refreshed.accessToken === undefined) {
							return yield* new AuthorizationError({
								message: 'Missing access token in OAuth response',
								code: 'credentials_error',
							})
						}
						return HttpClientRequest.bearerToken(refreshed.accessToken)(request)
					}
					if (accessToken === undefined) {
						return yield* new AuthorizationError({
							message: 'Missing access token in OAuth response',
							code: 'credentials_error',
						})
					}
					return HttpClientRequest.bearerToken(accessToken)(request)
				}),
			),
			HttpClient.tap((response) => {
				if (response.status === 401) {
					return Effect.fail(
						new AuthorizationError({
							message: 'Unauthorized',
							code: 'unauthorized',
						}),
					)
				}

				return Effect.void
			}),
		)
	})
