import {
	HttpBody,
	HttpClient,
	HttpClientRequest,
	HttpClientResponse,
} from '@effect/platform'
import { DateTime, Duration, Effect, pipe, Redacted, Schema } from 'effect'

/**
 * OAuth client utilities for obtaining and attaching client credentials tokens.
 */
export namespace OAuthClient {
	export declare const AuthorizationErrorTypeId: unique symbol
	export type AuthorizationErrorTypeId = typeof AuthorizationErrorTypeId

	/** Error type for OAuth authorization failures. */
	export class AuthorizationError extends Schema.TaggedError<AuthorizationError>(
		'@ballatech/effect-oauth-client/AuthorizationError',
	)('@ballatech/effect-oauth-client/AuthorizationError', {
		message: Schema.String,
		code: Schema.Literal('credentials_error', 'client_error', 'unauthorized'),
	}) {
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

			const getNewCredentials = pipe(
				HttpClientRequest.post(tokenUrl),
				HttpClientRequest.setBody(
					HttpBody.urlParams([
						['grant_type', 'client_credentials'],
						['scope', scope ? scope : ''],
						['audience', audience ? audience : ''],
					]),
				),
				HttpClientRequest.basicAuth(clientId, Redacted.value(clientSecret)),
				HttpClientRequest.setHeader(
					'Content-Type',
					'application/x-www-form-urlencoded',
				),
				client.execute,
				Effect.flatMap(
					HttpClientResponse.schemaBodyJson(
						Schema.Struct({
							access_token: Schema.String,
							token_type: Schema.String,
							expires_in: Schema.Number,
						}),
					),
				),
				Effect.map((response) => ({
					accessToken: response.access_token,
					tokenType: response.token_type,
					expiresIn: response.expires_in,
				})),
				Effect.scoped,
				Effect.catchTags({
					ParseError: (error) =>
						new AuthorizationError({
							message: error.message,
							code: 'credentials_error',
						}),
					RequestError: (error) =>
						new AuthorizationError({
							message: error.message,
							code: 'client_error',
						}),
					ResponseError: (error) =>
						new AuthorizationError({
							message: error.message,
							code: 'client_error',
						}),
				}),
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

			const [creds, invalidateToken] = yield* Effect.cachedInvalidateWithTTL(
				getToken,
				ttl,
			)

			return client.pipe(
				HttpClient.mapRequestInput(HttpClientRequest.acceptJson),
				HttpClient.mapRequestInputEffect((request) =>
					Effect.gen(function* () {
						const { accessToken, expiresAt } = yield* creds
						const now = yield* DateTime.now
						if (DateTime.greaterThan(now, expiresAt)) {
							yield* invalidateToken
							return HttpClientRequest.bearerToken((yield* creds).accessToken)(
								request,
							)
						}
						return HttpClientRequest.bearerToken(accessToken)(request)
					}),
				),
				HttpClient.tap((response) => {
					if (response.status === 401) {
						return new AuthorizationError({
							message: 'Unauthorized',
							code: 'unauthorized',
						})
					}

					return Effect.void
				}),
				HttpClient.filterStatusOk,
			)
		})
}
