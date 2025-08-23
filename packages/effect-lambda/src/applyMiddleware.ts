import type { IncomingMessage, ServerResponse } from 'node:http'

type ObjectWithOptionalHeaders = {
	headers?: Headers
}

type Headers = Record<string, boolean | number | string>

export type Middleware = (
	req: IncomingMessage,
	res: ServerResponse,
	next: (err?: unknown) => void,
) => void

/**
 * This function applies a middleware to a response object to update its headers.
 *
 * Primarily used for applying helmet headers to a response object.
 * Supports the express middleware signature to allow for easy integration with the existing helmet middleware.
 *
 * @param middleware express middleware to apply header changes
 * @returns response with the header changes applied
 *
 * @example
 * import helmet from 'helmet';
 * import { applyMiddleware, RestApi } from 'effect-lambda';
 * import { Effect } from 'effect';
 *
 * const middleware = helmet({
 *     xXssProtection: true,
 * });
 * const result = applyMiddleware(middleware)({ headers: {} });
 *
 * expect(result.headers).toEqual(
 *     expect.objectContaining({ 'X-XSS-Protection': '0' }),
 * );
 *
 * // When using together with an ApiGatewayProxyHandler, you can apply the middleware to the handler effect:
 * const handlerEffect: HandlerEffect = Effect.succeed({
 *    statusCode: 200,
 *    body: 'Woohoo',
 * });
 * export const handler = handlerEffect.pipe(
 *    Effect.map(applyMiddleware(middleware)),
 *    RestApi.toLambdaHandler,
 * )();
 */
/**
 * Apply an Express-style middleware to a response-like object to mutate headers.
 */
export const applyMiddleware =
	(middleware: Middleware) =>
	<T extends ObjectWithOptionalHeaders>(response: T): T => {
		const headers: Headers = response.headers ? { ...response.headers } : {}
		const req = {} as IncomingMessage
		const res = {
			setHeader: (key: string, value: string) => {
				headers[key] = value
			},
			getHeader(name) {
				return headers[name]
			},
			removeHeader(name) {
				delete headers[name]
			},
		} as ServerResponse

		middleware(req, res, () => {})

		return {
			...response,
			headers: { ...headers },
		} satisfies T
	}
