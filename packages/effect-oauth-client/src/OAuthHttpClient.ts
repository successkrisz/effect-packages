import {
	type Config,
	Context,
	Data,
	DateTime,
	Duration,
	Effect,
	Layer,
	Predicate,
	Redacted,
	Schedule,
	Schema,
} from 'effect'
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
	readonly cause?: unknown
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
	/** Base URL prepended to all outgoing requests (e.g. `https://api.example.com`). */
	baseUrl?: string
	ttl?: Duration.Duration
	expiryBuffer?: Duration.Duration
}

/** Config-based credentials where each value is resolved from a `Config` provider. */
export type CredentialsConfig = {
	readonly clientId: Config.Config<string>
	readonly clientSecret: Config.Config<Redacted.Redacted<string>>
	readonly tokenUrl: Config.Config<string>
	readonly scope?: Config.Config<string>
	readonly audience?: Config.Config<string>
	readonly baseUrl?: Config.Config<string>
	readonly ttl?: Duration.Duration
	readonly expiryBuffer?: Duration.Duration
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
	baseUrl,
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

		const isTransientStatus = (status: number) => status === 429 || status >= 500

		const getNewCredentials = client
			.execute(
				HttpClientRequest.post(tokenUrl).pipe(
					HttpClientRequest.bodyUrlParams(tokenBody),
					HttpClientRequest.basicAuth(clientId, Redacted.value(clientSecret)),
					HttpClientRequest.setHeader('Content-Type', 'application/x-www-form-urlencoded'),
				),
			)
			.pipe(
				Effect.filterOrFail(
					(response) => !isTransientStatus(response.status),
					(response) =>
						new AuthorizationError({
							message: `Token endpoint returned ${response.status}`,
							code: 'client_error',
						}),
				),
				Effect.flatMap(HttpClientResponse.schemaBodyJson(tokenSchema)),
				Effect.map((response) => ({
					accessToken: response.access_token,
					expiresIn: response.expires_in,
				})),
				Effect.scoped,
				Effect.retry({
					while: (error) => !Schema.isSchemaError(error),
					schedule: Schedule.exponential('200 millis').pipe(Schedule.both(Schedule.recurs(2))),
				}),
				Effect.mapError(
					(error) =>
						new AuthorizationError({
							message: error instanceof Error ? error.message : 'Failed to fetch OAuth credentials',
							code: Schema.isSchemaError(error) ? 'credentials_error' : 'client_error',
							cause: error,
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

		const withBaseUrl = baseUrl
			? HttpClient.mapRequestInput(HttpClientRequest.prependUrl(baseUrl))(client)
			: client

		return withBaseUrl.pipe(
			HttpClient.mapRequestInput(HttpClientRequest.acceptJson),
			HttpClient.mapRequestInputEffect((request) =>
				Effect.gen(function* () {
					const { accessToken, expiresAt } = yield* creds
					const now = yield* DateTime.now
					if (DateTime.isGreaterThan(now, expiresAt)) {
						yield* invalidateToken
						const refreshed = yield* creds
						return HttpClientRequest.bearerToken(refreshed.accessToken)(request)
					}
					return HttpClientRequest.bearerToken(accessToken)(request)
				}),
			),
			HttpClient.transform((effect) =>
				effect.pipe(
					Effect.tap((response) => {
						if (response.status === 401) {
							return invalidateToken.pipe(
								Effect.andThen(
									Effect.fail(
										new AuthorizationError({
											message: 'Unauthorized',
											code: 'unauthorized',
										}),
									),
								),
							)
						}
						return Effect.void
					}),
					Effect.retry({
						while: (error) => isAuthorizationError(error) && error.code === 'unauthorized',
						times: 1,
					}),
				),
			),
		)
	})

/**
 * Like {@link make}, but resolves credentials from `Config` values.
 *
 * This avoids the `Config → asEffect → flatMap → make` boilerplate
 * when credentials come from environment variables or a config provider.
 */
export const makeFromConfig = (config: CredentialsConfig) =>
	Effect.gen(function* () {
		return yield* make({
			clientId: yield* config.clientId,
			clientSecret: yield* config.clientSecret,
			tokenUrl: yield* config.tokenUrl,
			scope: config.scope ? yield* config.scope : undefined,
			audience: config.audience ? yield* config.audience : undefined,
			baseUrl: config.baseUrl ? yield* config.baseUrl : undefined,
			ttl: config.ttl,
			expiryBuffer: config.expiryBuffer,
		})
	})

/**
 * The `HttpClient` shape returned by {@link make} / {@link makeFromConfig}.
 *
 * Use this when you need multiple OAuth clients in the same program — create a
 * dedicated `Context.Service` tag for each API:
 *
 * ```ts
 * class AzureClient extends Context.Service<AzureClient, OAuthClient.Client>()('AzureClient') {}
 * class GoogleClient extends Context.Service<GoogleClient, OAuthClient.Client>()('GoogleClient') {}
 * ```
 *
 * The built-in {@link OAuthHttpClient} tag is a convenience for programs that only
 * talk to a single OAuth-protected API. When you connect to multiple APIs, define
 * your own tags with this type and wire them with {@link make} / {@link makeFromConfig}.
 */
export type Client = Effect.Success<ReturnType<typeof make>>

/**
 * Built-in service tag for an OAuth-authenticated `HttpClient`.
 *
 * This is a convenience for the common single-client case — use with
 * {@link layer} or {@link layerFromConfig}. When your program connects to
 * multiple OAuth-protected APIs, create your own tags instead:
 *
 * ```ts
 * class AzureClient extends Context.Service<AzureClient, OAuthClient.Client>()('AzureClient') {}
 * class GoogleClient extends Context.Service<GoogleClient, OAuthClient.Client>()('GoogleClient') {}
 * ```
 */
export class OAuthHttpClient extends Context.Service<OAuthHttpClient, Client>()(
	'@ballatech/effect-oauth-client/OAuthHttpClient',
) {}

/** Build a `Layer` that provides {@link OAuthHttpClient} from static credentials. */
export const layer = (credentials: Credentials) => Layer.effect(OAuthHttpClient)(make(credentials))

/** Build a `Layer` that provides {@link OAuthHttpClient} from `Config` values. */
export const layerFromConfig = (config: CredentialsConfig) =>
	Layer.effect(OAuthHttpClient)(makeFromConfig(config))
