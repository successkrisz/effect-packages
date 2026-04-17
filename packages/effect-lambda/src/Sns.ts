import { Context } from 'effect'
import type { AwsSNSEvent } from './aws.ts'
import { makeToHandler } from './makeToHandler.ts'

/**
 * Export types from aws-lambda
 */
export type { AwsSNSEvent }

/**
 * Context tag for an incoming SNS event.
 */
export class SNSEvent extends Context.Service<SNSEvent, AwsSNSEvent>()('@effect-lambda/SNSEvent') {}

/**
 * Convert an effectful SNS program into an SNS Lambda handler.
 */

export const toLambdaHandler = makeToHandler<typeof SNSEvent, void>(SNSEvent)
