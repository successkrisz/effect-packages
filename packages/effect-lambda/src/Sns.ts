import { Context } from 'effect'
import type { AwsSNSEvent } from './aws'
import { makeToHandler } from './makeToHandler'

/**
 * Export types from aws-lambda
 */
export type { AwsSNSEvent }

/**
 * Context tag for an incoming SNS event.
 */
export class SNSEvent extends Context.Tag('@effect-lambda/SNSEvent')<
	SNSEvent,
	AwsSNSEvent
>() {}

/**
 * Convert an effectful SNS program into an SNS Lambda handler.
 */

export const toLambdaHandler = makeToHandler<typeof SNSEvent, void>(SNSEvent)
