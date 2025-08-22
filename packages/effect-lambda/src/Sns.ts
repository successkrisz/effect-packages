import type { SNSEvent as _SNSEvent } from 'aws-lambda'
import { Context } from 'effect'
import { makeToHandler } from './makeToHandler'

export class SNSEvent extends Context.Tag('@effect-lambda/SNSEvent')<
	SNSEvent,
	_SNSEvent
>() {}

/**
 * Transform an effect into an SNSHandler.
 *
 * @param effect Effect.Effect<void, never, SNSEvent | HandlerContext>
 * @returns SNSHandler
 *
 * @example
 * ```typescript
 * import { Console, Effect } from 'effect'
 * import { toLambdaHandler } from '@effect-lambda/Sns'
 *
 * export const handler = toLambdaHandler(
 *    Effect.void.pipe(
 *       Effect.tap(() => Console.log('Hello, World!'))
 *   )
 * )()
 */

export const toLambdaHandler = makeToHandler<typeof SNSEvent, void>(SNSEvent)
