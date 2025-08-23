import { Effect, type ParseResult, Schema as s } from 'effect'
import type { AwsAPIGatewayProxyEvent } from '../aws'

/** Determine if a content type should be treated as JSON. */
const isJsonContentType = (contentType: string | undefined): boolean => {
	if (!contentType) return false
	const normalized = contentType.toLowerCase()
	return (
		normalized.includes('application/json') ||
		normalized.includes('application/vnd.api+json') ||
		normalized.endsWith('+json')
	)
}

/**
 * Parse JSON request bodies for API Gateway proxy events.
 *
 * - Respects `isBase64Encoded` by decoding the body when true
 * - Accepts any media type ending with `+json` or common JSON content types
 * - Returns the parsed JSON and preserves the original body at `rawBody`
 */
export const jsonBodyParser = <T extends AwsAPIGatewayProxyEvent>(
	event: T,
): Effect.Effect<T & { rawBody?: T['body'] }, ParseResult.ParseError> => {
	if (event.body !== null && isJsonContentType(event.headers['content-type'])) {
		const { body } = event
		return Effect.if({
			onTrue: () => Effect.succeed(Buffer.from(body, 'base64').toString()),
			onFalse: () => Effect.succeed(body),
		})(event.isBase64Encoded).pipe(
			Effect.flatMap(s.decodeEither(s.parseJson(s.Unknown))),
			Effect.map((jsonBody) => ({
				...event,
				body: jsonBody,
				rawBody: body,
			})),
		)
	}

	return Effect.succeed(event)
}
