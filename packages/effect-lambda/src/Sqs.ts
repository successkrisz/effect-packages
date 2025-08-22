import type { SQSEvent as _SQSEvent, SQSRecord as _SQSRecord } from 'aws-lambda'
import { Context, Effect, Either } from 'effect'
import type { BatchResponse } from './common'
import { makeToHandler } from './makeToHandler'

/**
 * Represents an SQS event in the context of AWS Lambda.
 * Extends the base SQSEvent from AWS Lambda types.
 *
 * @class
 * @extends {Context.Tag}
 */
export class SQSEvent extends Context.Tag('@effect-lambda/SQSEvent')<
	SQSEvent,
	_SQSEvent
>() {}

/**
 * Represents a single SQS record in the context of AWS Lambda.
 * Extends the base SQSRecord from AWS Lambda types.
 *
 * @class
 * @extends {Context.Tag}
 */
export class SQSRecord extends Context.Tag('@effect-lambda/SQSRecord')<
	SQSRecord,
	_SQSRecord
>() {}

/**
 * Extracts the message bodies from an SQS event.
 */
export const SQSMessageBodies = SQSEvent.pipe(
	Effect.map((event) => event.Records.map((record) => record.body)),
)

/**
 * Transform an effect into an SNSHandler.
 *
 * @param effect Effect.Effect<void, never, SQSEvent | HandlerContext>
 * @returns SNSHandler
 *
 * @example
 * ```typescript
 * import { SQSEvent, toLambdaHandler } from '@effect-lambda/Sqs'
 * import { Effect, Console } from 'effect'
 *
 * // Define an effect that processes each message in the SQS event
 * const processSQSMessages = SQSEvent.pipe(
 *   Effect.map((event) => event.Records),
 *   Effect.tap((records) =>
 *     Effect.forEach(records, (record) =>
 *       Console.log(`Processing message: ${record.body}`)
 *     )
 *   )
 * )
 *
 * // Convert the effect into a Lambda handler
 * export const handler = processSQSMessages.pipe(toLambdaHandler)
 * ```
 */
export const toLambdaHandler = makeToHandler<
	typeof SQSEvent,
	// biome-ignore lint/suspicious/noConfusingVoidType: SQS handler return type is void | BatchResponse
	void | BatchResponse
>(SQSEvent)

/**
 * recordProcessorAdapter - adapts a single record processor effect to a batch processor effect
 *
 * you can control the concurrency of the batch processing by setting the concurrency outside
 * of this function, with the default being `unbounded`.
 *
 * @param effect Effect.Effect<void, E, SQSRecord> - an effect handling a single SQS record
 * @returns A handler effect compatible with SQSEventHandler
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
