import type { AwsAPIGatewayProxyEvent } from '../aws'

/**
 * Normalize header keys to lowercase without mutating the input.
 */
export const normalizeHeaders = (headers: {
	[key: string]: string | undefined
}) =>
	Object.keys(headers).reduce(
		(acc, key) => {
			acc[key.toLowerCase()] = headers[key]
			return acc
		},
		{} as { [key: string]: string | undefined },
	)

/**
 * Return a new event with lowercased `headers` and original `rawHeaders` preserved.
 */
export const headerNormalizer = <T extends AwsAPIGatewayProxyEvent>(
	event: T,
): T & {
	rawHeaders: T['headers']
} => ({
	...event,
	headers: normalizeHeaders(event.headers),
	rawHeaders: event.headers,
})
