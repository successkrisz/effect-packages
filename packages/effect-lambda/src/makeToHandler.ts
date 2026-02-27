import { type Config, Effect, Layer, type ServiceMap } from 'effect'
import type { Handler } from './aws'
import { HandlerContext } from './common'
import { lambdaRuntimeFromLayer } from './internal/lambdaRuntime'

/**
 * Create a curried adapter to turn an `Effect` program into a Lambda handler for a given event tag.
 *
 * @typeParam T - Service tag representing the event type injected into the program
 * @typeParam A - Success output of the program and handler
 * @param eventTag Tag used to provide the incoming event to the effect environment
 * @returns A function that, given a program, returns another function that accepts an optional `layer` and `options`.
 *
 * @remarks
 * - If the program depends only on the event and `HandlerContext`, the returned function's `params` are optional and
 *   default to an empty layer.
 * - If the program requires additional services, a `layer` providing those services is required.
 * - The adapter logs defects and wires the effect into a managed runtime derived from the provided layer.
 *
 * @example
 * ```ts
 * import { makeToHandler } from 'effect-lambda'
 * import { Layer, Effect, ServiceMap } from 'effect'
 *
 * class Event extends ServiceMap.Service<Event, number>()('@app/event') {}
 *
 * // No extra dependencies
 * export const handler = makeToHandler<typeof Event, number>(Event)(
 *   Event.use((n) => Effect.succeed(n * 2))
 * )()
 *
 * // With dependencies
 * class Db extends ServiceMap.Service<Db, { query: (sql: string) => Effect.Effect<unknown> }>()('@app/db') {}
 * export const handlerWithDeps = makeToHandler<typeof Event, number>(Event)(
 *   Effect.gen(function* () {
 *     const n = yield* Event
 *     const db = yield* Db
 *     yield* db.query('select 1')
 *     return n
 *   })
 * )({ layer: Layer.succeed(Db, { query: () => Effect.void }) })
 * ```
 */

// biome-ignore lint/suspicious/noExplicitAny: pattern is used for generic tags
export function makeToHandler<T extends ServiceMap.Service<any, any>, A>(eventTag: T) {
	// Overload for when no dependencies are needed (R is never)
	function toHandler<E = never>(
		handler: Effect.Effect<
			NoInfer<A>,
			Config.ConfigError,
			ServiceMap.Service.Identifier<T> | HandlerContext
		> &
			([A] extends [never] ? never : unknown),
	): (params?: {
		layer?: Layer.Layer<never, E>
		options?: { readonly memoMap?: Layer.MemoMap }
	}) => Handler<ServiceMap.Service.Shape<T>, A>

	// Overload for when dependencies are needed (R is not never)
	function toHandler<R, E = never>(
		handler: Effect.Effect<NoInfer<A>, Config.ConfigError, R> &
			([A] extends [never] ? never : unknown),
	): (params: {
		layer: Layer.Layer<Exclude<R, ServiceMap.Service.Identifier<T> | HandlerContext>, E>
		options?: { readonly memoMap?: Layer.MemoMap }
	}) => Handler<ServiceMap.Service.Shape<T>, A>

	// Implementation
	function toHandler<R extends never, E = never>(
		handler: Effect.Effect<NoInfer<A>, Config.ConfigError, R> &
			([A] extends [never] ? never : unknown),
	): (params?: {
		layer: Layer.Layer<Exclude<R, ServiceMap.Service.Identifier<T> | HandlerContext>, E>
		options?: { readonly memoMap?: Layer.MemoMap }
	}) => Handler<ServiceMap.Service.Shape<T>, A> {
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
