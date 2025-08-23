import { Context } from 'effect'
import type { LambdaContext } from './aws'

/**
 * Context tag for the AWS Lambda runtime `Context` object.
 */
export class HandlerContext extends Context.Tag(
	'@effect-lambda/HandlerContext',
)<HandlerContext, LambdaContext>() {}

/**
 * shared type for various batch response types used in sns, sqs and dynamodb handlers
 */
export type BatchResponse = { batchItemFailures: { itemIdentifier: string }[] }
