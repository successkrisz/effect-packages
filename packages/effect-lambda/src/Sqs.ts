/**
 * Adapters for SQS-triggered Lambda functions.
 *
 * The incoming `SQSEvent` is provided to the program through the `SqsEvent`
 * service. `recordProcessorAdapter` turns a single-record program into a batch
 * program that reports per-record failures as `batchItemFailures`.
 *
 * @since 1.0.0
 */
import { Context, Effect, Result } from 'effect'
import type { AwsSQSEvent, AwsSQSRecord, Handler } from './aws.ts'
import type { BatchResponse } from './common.ts'
import { makeToHandler } from './makeToHandler.ts'

export type {
	/**
	 * @since 1.0.0
	 * @category models
	 */
	AwsSQSEvent,
	/**
	 * @since 1.0.0
	 * @category models
	 */
	AwsSQSRecord,
	// Lets emitted declarations of `toLambdaHandler` name `Handler` via this module instead of
	// the unresolvable `aws-lambda/handler` subpath.
	/**
	 * @since 1.0.0
	 * @category models
	 */
	Handler,
}

/**
 * Service providing the incoming SQS event.
 *
 * @since 1.0.0
 * @category services
 */
export class SqsEvent extends Context.Service<SqsEvent, AwsSQSEvent>()(
	'effect-lambda/Sqs/SqsEvent',
) {}

/**
 * Service providing a single SQS record, used together with `recordProcessorAdapter`.
 *
 * @since 1.0.0
 * @category services
 */
export class SqsRecord extends Context.Service<SqsRecord, AwsSQSRecord>()(
	'effect-lambda/Sqs/SqsRecord',
) {}

/**
 * The message bodies of all records in the SQS event.
 *
 * @since 1.0.0
 * @category accessors
 */
export const messageBodies = SqsEvent.useSync((event) => event.Records.map((record) => record.body))

/**
 * Convert an effectful program into an SQS batch Lambda handler.
 *
 * @example
 * ```ts
 * import { SqsEvent, toLambdaHandler } from 'effect-lambda/Sqs'
 * import { Console } from 'effect'
 *
 * const program = SqsEvent.use((event) => Console.log(`records: ${event.Records.length}`))
 *
 * export const handler = toLambdaHandler(program)()
 * ```
 *
 * @since 1.0.0
 * @category converting
 */
export const toLambdaHandler = makeToHandler<
	typeof SqsEvent,
	// biome-ignore lint/suspicious/noConfusingVoidType: SQS handler return type is void | BatchResponse
	void | BatchResponse
>(SqsEvent)

/**
 * Adapt a single-record effect into a batch SQS program that returns a `BatchResponse`.
 *
 * Records are processed sequentially, matching SQS batch failure semantics.
 * Every record whose effect fails is reported in `batchItemFailures`.
 *
 * @example
 * ```ts
 * import { recordProcessorAdapter, SqsRecord, toLambdaHandler } from 'effect-lambda/Sqs'
 * import { Console } from 'effect'
 *
 * const processRecord = SqsRecord.use((record) => Console.log(record.body))
 *
 * export const handler = toLambdaHandler(processRecord.pipe(recordProcessorAdapter))()
 * ```
 *
 * @since 1.0.0
 * @category combinators
 */
export const recordProcessorAdapter = <R = SqsRecord, E = never>(
	effect: Effect.Effect<void, E, R>,
): Effect.Effect<BatchResponse, never, SqsEvent | Exclude<R, SqsRecord>> =>
	Effect.gen(function* () {
		const { Records } = yield* SqsEvent

		const effects = Records.map((record) => effect.pipe(Effect.provideService(SqsRecord, record)))
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

/**
 * @deprecated Use `SqsEvent`.
 * @since 1.0.0
 * @category services
 */
export const SQSEvent = SqsEvent
/**
 * @deprecated Use `SqsEvent`.
 * @since 1.0.0
 * @category services
 */
export type SQSEvent = SqsEvent

/**
 * @deprecated Use `SqsRecord`.
 * @since 1.0.0
 * @category services
 */
export const SQSRecord = SqsRecord
/**
 * @deprecated Use `SqsRecord`.
 * @since 1.0.0
 * @category services
 */
export type SQSRecord = SqsRecord

/**
 * @deprecated Use `messageBodies`.
 * @since 1.0.0
 * @category accessors
 */
export const SQSMessageBodies = messageBodies
