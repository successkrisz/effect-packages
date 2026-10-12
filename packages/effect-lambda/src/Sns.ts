/**
 * Adapters for SNS-triggered Lambda functions.
 *
 * The incoming `SNSEvent` is provided to the program through the `SnsEvent`
 * service.
 *
 * @since 1.0.0
 */
import { Context } from 'effect'
import type { AwsSNSEvent, Handler } from './aws.ts'
import { makeToHandler } from './makeToHandler.ts'

export type {
	/**
	 * @since 1.0.0
	 * @category models
	 */
	AwsSNSEvent,
	// Lets emitted declarations of `toLambdaHandler` name `Handler` via this module instead of
	// the unresolvable `aws-lambda/handler` subpath.
	/**
	 * @since 1.0.0
	 * @category models
	 */
	Handler,
}

/**
 * Service providing the incoming SNS event.
 *
 * @since 1.0.0
 * @category services
 */
export class SnsEvent extends Context.Service<SnsEvent, AwsSNSEvent>()(
	'effect-lambda/Sns/SnsEvent',
) {}

/**
 * Convert an effectful program into an SNS Lambda handler.
 *
 * @example
 * ```ts
 * import { Sns } from 'effect-lambda'
 * import { Effect } from 'effect'
 *
 * export const handler = Sns.toLambdaHandler(
 *   Sns.SnsEvent.use((event) => Effect.log(`records: ${event.Records.length}`)),
 * )()
 * ```
 *
 * @since 1.0.0
 * @category converting
 */
export const toLambdaHandler = makeToHandler<typeof SnsEvent, void>(SnsEvent)

/**
 * @deprecated Use `SnsEvent`.
 * @since 1.0.0
 * @category services
 */
export const SNSEvent = SnsEvent
/**
 * @deprecated Use `SnsEvent`.
 * @since 1.0.0
 * @category services
 */
export type SNSEvent = SnsEvent
