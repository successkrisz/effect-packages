import type { APIGatewayProxyEvent } from 'aws-lambda'

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

export const headerNormalizer = <T extends APIGatewayProxyEvent>(
	event: T,
): T & {
	rawHeaders: T['headers']
} => ({
	...event,
	headers: normalizeHeaders(event.headers),
	rawHeaders: event.headers,
})
