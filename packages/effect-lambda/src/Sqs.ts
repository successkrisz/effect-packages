import { Context, Effect, Either } from 'effect'
import type { AwsSQSEvent, AwsSQSRecord } from './aws'
import type { BatchResponse } from './common'
import { makeToHandler } from './makeToHandler'

/**
 * Context tag for an incoming SQS event.
 */
export class SQSEvent extends Context.Tag('@effect-lambda/SQSEvent')<
	SQSEvent,
	AwsSQSEvent
>() {}

/**
 * Context tag for a single SQS record.
 */
export class SQSRecord extends Context.Tag('@effect-lambda/SQSRecord')<
	SQSRecord,
	AwsSQSRecord
>() {}

/**
 * Extract the message bodies from all records in the SQS event.
 */
export const SQSMessageBodies = SQSEvent.pipe(
	Effect.map((event) => event.Records.map((record) => record.body)),
)

/**
 * Convert an effectful SQS program into an SQS batch Lambda handler.
 *
 * @example
 * ```ts
 * import { SQSEvent, toLambdaHandler } from '@effect-lambda/Sqs'
 * import { Effect, Console } from 'effect'
 *
 * const program = SQSEvent.pipe(
 *   Effect.tap((e) => Console.log(`records: ${e.Records.length}`))
 * )
 * export const handler = program.pipe(toLambdaHandler)()
 * ```
 */
export const toLambdaHandler = makeToHandler<
	typeof SQSEvent,
	// biome-ignore lint/suspicious/noConfusingVoidType: SQS handler return type is void | BatchResponse
	void | BatchResponse
>(SQSEvent)

/**
 * Adapt a single-record effect into a batch SQS program that returns a `BatchResponse`.
 *
 * Control concurrency via `Effect.withConcurrency` around the returned effect (defaults to `unbounded`).
 *
 * @param effect Effect that processes a single `SQSRecord`.
 * @returns Effect producing a `BatchResponse` compatible with SQS batch handlers.
 *
 * @example
 * ```typescript
 * import { Console, Effect, Either } from 'effect';
 * import { SQSRecord, toLambdaHandler, recordProcessorAdapter } from '@effect-lambda/Sqs';
 * // Define an effect that processes a single SQS record
 * const processRecord = SQSRecord.pipe(
 *     Effect.tap((record) => Console.log(record.body))
 * );
 *
 * // Adapt the single record processor effect to handle a batch of records and use it with an SQSEventHandler
 * export const handler = processRecord.pipe(
 *    recordProcessorAdapter<never>, // type parameter is required due to TypeScript limitations
 *    Effect.withConcurrency(1), // optional if want sequential processing
 *    toLambdaHandler,
 * )();
 * ```
 */
export const recordProcessorAdapter = <R = SQSRecord, E = never>(
	effect: Effect.Effect<void, E, R>,
): Effect.Effect<BatchResponse, never, SQSEvent | Exclude<R, SQSRecord>> =>
	Effect.gen(function* () {
		const { Records } = yield* SQSEvent

		const effects = Records.map((record) =>
			effect.pipe(Effect.provideService(SQSRecord, record)),
		)
		const results = yield* Effect.all(effects, {
			concurrency: 'inherit',
			mode: 'either',
		})

		return {
			batchItemFailures: results
				.map((eff, i) => [eff, Records[i].messageId] as const)
				.filter(([eff]) => Either.isLeft(eff))
				.map(([_, id]) => ({ itemIdentifier: id })),
		}
	})
