import { Context, Effect, Result } from 'effect'
import type { AwsSQSEvent, AwsSQSRecord } from './aws.ts'
import type { BatchResponse } from './common.ts'
import { makeToHandler } from './makeToHandler.ts'

/**
 * Export types from aws-lambda
 */
export type { AwsSQSEvent, AwsSQSRecord }

/**
 * Context tag for an incoming SQS event.
 */
export class SQSEvent extends Context.Service<SQSEvent, AwsSQSEvent>()(
	'effect-lambda/Sqs/SQSEvent',
) {}

/**
 * Context tag for a single SQS record.
 */
export class SQSRecord extends Context.Service<SQSRecord, AwsSQSRecord>()(
	'effect-lambda/Sqs/SQSRecord',
) {}

/**
 * Extract the message bodies from all records in the SQS event.
 */
export const SQSMessageBodies = SQSEvent.useSync((event) =>
	event.Records.map((record) => record.body),
)

/**
 * Convert an effectful SQS program into an SQS batch Lambda handler.
 *
 * @example
 * ```ts
 * import { SQSEvent, toLambdaHandler } from '@effect-lambda/Sqs'
 * import { Effect, Console } from 'effect'
 *
 * const program = SQSEvent.use((e) =>
 *   Console.log(`records: ${e.Records.length}`)
 * )
 * export const handler = toLambdaHandler(program)()
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
 * Records are processed sequentially by default, matching SQS batch failure semantics.
 *
 * @param effect Effect that processes a single `SQSRecord`.
 * @returns Effect producing a `BatchResponse` compatible with SQS batch handlers.
 *
 * @example
 * ```typescript
 * import { Console, Effect } from 'effect';
 * import { SQSRecord, toLambdaHandler, recordProcessorAdapter } from '@effect-lambda/Sqs';
 *
 * const processRecord = SQSRecord.use((record) =>
 *   Console.log(record.body)
 * );
 *
 * export const handler = processRecord.pipe(
 *    recordProcessorAdapter<never>,
 *    toLambdaHandler,
 * )();
 * ```
 */
export const recordProcessorAdapter = <R = SQSRecord, E = never>(
	effect: Effect.Effect<void, E, R>,
): Effect.Effect<BatchResponse, never, SQSEvent | Exclude<R, SQSRecord>> =>
	Effect.gen(function* () {
		const { Records } = yield* SQSEvent

		const effects = Records.map((record) => effect.pipe(Effect.provideService(SQSRecord, record)))
		const results = yield* Effect.all(effects, {
			mode: 'result',
		})

		return {
			batchItemFailures: results
				.map((eff, i) => [eff, Records[i].messageId] as const)
				.filter(([eff]) => Result.isFailure(eff))
				.map(([_, id]) => ({ itemIdentifier: id })),
		}
	})
