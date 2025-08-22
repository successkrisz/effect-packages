import type { Layer } from 'effect'
import { Console, Effect, ManagedRuntime } from 'effect'

export const lambdaRuntimeFromLayer = <R, E>(
	layer: Layer.Layer<R, E>,
	options?: { readonly memoMap?: Layer.MemoMap },
): ManagedRuntime.ManagedRuntime<R, E> => {
	const runtime = ManagedRuntime.make(layer, options?.memoMap)

	const signalHandler: NodeJS.SignalsListener = (signal) => {
		Effect.runFork(
			Effect.gen(function* () {
				yield* Console.log(`[runtime] ${signal} received`)
				yield* Console.log('[runtime] cleaning up')
				yield* runtime.disposeEffect
				yield* Console.log('[runtime] exiting')
				yield* Effect.sync(() => process.exit(0))
			}),
		)
	}

	process.on('SIGTERM', signalHandler)
	process.on('SIGINT', signalHandler)

	return runtime
}
