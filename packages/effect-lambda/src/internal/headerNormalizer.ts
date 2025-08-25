import type { AwsAPIGatewayProxyEvent, AwsAPIGatewayProxyEventV2 } from '../aws'

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
export function headerNormalizer(
	event: AwsAPIGatewayProxyEvent,
): AwsAPIGatewayProxyEvent & {
	rawHeaders: AwsAPIGatewayProxyEvent['headers']
}
export function headerNormalizer(
	event: AwsAPIGatewayProxyEventV2,
): AwsAPIGatewayProxyEventV2 & {
	rawHeaders: AwsAPIGatewayProxyEventV2['headers']
}
export function headerNormalizer(
	event: AwsAPIGatewayProxyEvent | AwsAPIGatewayProxyEventV2,
) {
	const normalized = normalizeHeaders(event.headers)
	return {
		...event,
		headers: normalized,
		rawHeaders: event.headers,
	} satisfies typeof event & { rawHeaders: (typeof event)['headers'] }
}
