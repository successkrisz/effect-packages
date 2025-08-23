import { Effect } from 'effect'

/**
 * Run an array of effects in parallel with unbounded concurrency, collecting `Either` results.
 */
export const runPar = <T, E = never>(effects: Array<Effect.Effect<T, E>>) =>
	Effect.all(effects, { concurrency: 'unbounded', mode: 'either' })

// Utility type to generate the effect signature for a handler function.
/**
 * Utility type to turn a Lambda-style handler signature into an `Effect` signature.
 */
export type ToEffect<
	// biome-ignore lint/suspicious/noExplicitAny: Lambda handler signature
	// biome-ignore lint/suspicious/noConfusingVoidType: Lambda handler signature
	T extends (...args: any) => void | Promise<any>,
	R,
> = Effect.Effect<Exclude<Awaited<ReturnType<T>>, void>, never, R>

/** Lowercase object keys at the type level. */
export type LowercaseKeys<T> = {
	[K in keyof T as Lowercase<string & K>]: T[K]
}
