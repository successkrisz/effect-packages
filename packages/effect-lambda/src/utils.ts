/**
 * Internal helpers. Only `ToEffect` is part of the public API.
 *
 * @since 1.0.0
 */
import { Effect } from 'effect'

/**
 * Run an array of effects in parallel with unbounded concurrency, collecting `Result` values.
 *
 * @internal
 */
export const runPar = <T, E = never>(effects: Array<Effect.Effect<T, E>>) =>
	Effect.all(effects, { concurrency: 'unbounded', mode: 'result' })

/**
 * Turn a Lambda-style handler signature into the matching `Effect` signature.
 *
 * @since 1.0.0
 * @category utility types
 */
export type ToEffect<
	// biome-ignore lint/suspicious/noExplicitAny: Lambda handler signature
	// biome-ignore lint/suspicious/noConfusingVoidType: Lambda handler signature
	T extends (...args: any) => void | Promise<any>,
	R,
> = Effect.Effect<Exclude<Awaited<ReturnType<T>>, void>, never, R>

/** @internal */
export type LowercaseKeys<T> = {
	[K in keyof T as Lowercase<string & K>]: T[K]
}

/** @internal */
export const lowercaseKeys = <T = unknown>(record: Record<string, T>) =>
	Object.fromEntries(Object.entries(record).map(([k, v]) => [k.toLowerCase(), v]))

/** @internal */
export type ForbidKeys<K extends PropertyKey> = { [P in K]?: never }

/** @internal */
// biome-ignore lint/suspicious/noExplicitAny: utility type
export type ForbidKeysWithValues<K extends PropertyKey, V> = ForbidKeys<K> & Record<keyof any, V>
