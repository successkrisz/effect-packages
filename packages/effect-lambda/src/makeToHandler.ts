import { type ConfigError, type Context, Effect, Layer } from 'effect'
import type { Handler } from './aws'
import { HandlerContext } from './common'
import { lambdaRuntimeFromLayer } from './internal/lambdaRuntime'

/**
 * Factory for creating toLambdaHandler functions with layer support.
 *
 * @param eventTag - The event tag to use for the handler.
 * @returns A function that takes a handler effect and returns another function that accepts layer and options.
 *
 * @remarks
 * The returned function is curried: first call takes the handler effect, second call takes the layer and options.
 * The function has two overloads:
 * - When the handler has no additional dependencies (beyond event and handler context), the layer parameter is optional
 * - When the handler depends on additional services, the layer parameter is required
 * If no layer is provided, it defaults to Layer.empty.
 *
 * @example
 * ```typescript
 * import { makeToHandler } from '@effect-lambda/lambda'
 * import { Layer, Effect, Context } from 'effect'
 *
 * class Event extends Context.Tag('@foobar/some-event')<Event, number>() {}
 *
 * // Simple handler without dependencies - layer parameter is optional
 * const simpleHandler = makeToHandler<typeof Event, number>(Event)(
 *   Effect.map(Event, event => ({ result: event * 2 }))
 * )() // No parameters needed
 *
 * // Or with empty layer explicitly
 * const simpleHandlerExplicit = makeToHandler<typeof Event, number>(Event)(
 *   Effect.map(Event, event => ({ result: event * 2 }))
 * )({ layer: Layer.empty })
 *
 * // Handler with dependencies - layer parameter is required
 * type User = { id: number; name: string }
 * class DatabaseService extends Context.Tag('@foobar/database')<
 *   DatabaseService,
 *   { query: (sql: string) => Effect.Effect<User[]> }
 * >() {}
 *
 * const handlerWithDeps = makeToHandler<typeof Event, { foo: User[] }>(Event)(
 *   Effect.gen(function* () {
 *     const event = yield* Event
 *     const db = yield* DatabaseService
 *     const result = yield* db.query(`SELECT * FROM users WHERE id = ${event}`)
 *     return { foo: result }
 *   })
 * )({
 *   layer: Layer.succeed(DatabaseService, {
 *     query: (sql) => Effect.succeed([{ id: 1, name: 'John' }])
 *   })
 * })
 * ```
 */

// biome-ignore lint/suspicious/noExplicitAny: pattern is used for generic tags
export function makeToHandler<T extends Context.Tag<any, any>, A>(eventTag: T) {
	// Overload for when no dependencies are needed (R is never)
	function toHandler<E = never>(
		handler: Effect.Effect<
			NoInfer<A>,
			typeof ConfigError,
			Context.Tag.Identifier<T> | HandlerContext
		> &
			([A] extends [never] ? never : unknown),
	): (params?: {
		layer?: Layer.Layer<never, E>
		options?: { readonly memoMap?: Layer.MemoMap }
	}) => Handler<Context.Tag.Service<T>, A>

	// Overload for when dependencies are needed (R is not never)
	function toHandler<R, E = never>(
		handler: Effect.Effect<NoInfer<A>, typeof ConfigError, R> &
			([A] extends [never] ? never : unknown),
	): (params: {
		layer: Layer.Layer<
			Exclude<R, Context.Tag.Identifier<T> | HandlerContext>,
			E
		>
		options?: { readonly memoMap?: Layer.MemoMap }
	}) => Handler<Context.Tag.Service<T>, A>

	// Implementation
	function toHandler<R extends never, E = never>(
		handler: Effect.Effect<NoInfer<A>, typeof ConfigError, R> &
			([A] extends [never] ? never : unknown),
	): (params?: {
		layer: Layer.Layer<
			Exclude<R, Context.Tag.Identifier<T> | HandlerContext>,
			E
		>
		options?: { readonly memoMap?: Layer.MemoMap }
	}) => Handler<Context.Tag.Service<T>, A> {
		return (params) => {
			const { layer, options } = params || {}
			const runtime = lambdaRuntimeFromLayer(layer || Layer.empty, options)

			return (event, context) =>
				handler.pipe(
					Effect.tapDefect(Effect.logError),
					Effect.provide(
						Layer.mergeAll(
							Layer.sync(eventTag, () => event),
							Layer.sync(HandlerContext, () => context),
						),
					),
					runtime.runPromise,
				)
		}
	}

	return toHandler
}
