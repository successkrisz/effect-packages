export type OAuthClientConfig = {
	/** Base URL of the OAuth authorization server */
	authorityUrl: string
	/** Registered client identifier */
	clientId: string
	/** Optional redirect URI used in the authorization code flow */
	redirectUri?: string
}

export function createOAuthClient(config: OAuthClientConfig) {
	const { authorityUrl, clientId, redirectUri } = config
	if (!authorityUrl) throw new Error('authorityUrl is required')
	if (!clientId) throw new Error('clientId is required')

	return {
		get configuration() {
			return { authorityUrl, clientId, redirectUri }
		},
	}
}


