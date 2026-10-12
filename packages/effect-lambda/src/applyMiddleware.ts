/**
 * Apply Express-style header middleware (such as `helmet`) to Lambda responses.
 *
 * @since 1.0.0
 */
// @effect-diagnostics-next-line nodeBuiltinImport:off -- type-only import, no runtime dependency on Node
import type { IncomingMessage, ServerResponse } from 'node:http'

type ObjectWithOptionalHeaders = {
	headers?: Headers
}

type Headers = Record<string, boolean | number | string>

/**
 * Express-style middleware signature.
 *
 * @since 1.0.0
 * @category models
 */
export type Middleware = (
	req: IncomingMessage,
	res: ServerResponse,
	next: (err?: unknown) => void,
) => void

/**
 * Apply an Express-style middleware to a response-like object to update its headers.
 *
 * Only the header methods of the response (`setHeader`, `getHeader`,
 * `removeHeader`) are available to the middleware, which makes this suitable
 * for header-only middleware such as `helmet`.
 *
 * @example
 * ```ts
 * import helmet from 'helmet'
 * import { applyMiddleware, RestApi } from 'effect-lambda'
 * import { Effect, Layer } from 'effect'
 *
 * const handlerEffect: RestApi.HandlerEffect = Effect.succeed({ statusCode: 200, body: 'Woohoo' })
 *
 * export const handler = RestApi.toLambdaHandler(
 *   handlerEffect.pipe(Effect.map(applyMiddleware(helmet()))),
 * )({ layer: Layer.empty })
 * ```
 *
 * @since 1.0.0
 * @category combinators
 */
export const applyMiddleware =
	(middleware: Middleware) =>
	<T extends ObjectWithOptionalHeaders>(response: T): T => {
		const headers: Headers = response.headers !== undefined ? { ...response.headers } : {}
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
