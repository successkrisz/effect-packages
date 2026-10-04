import { Context } from 'effect'
import type { LambdaContext } from './aws.ts'

/**
 * Context tag for the AWS Lambda runtime `Context` object.
 */
export class HandlerContext extends Context.Service<HandlerContext, LambdaContext>()(
	'effect-lambda/common/HandlerContext',
) {}

/**
 * shared type for various batch response types used in sns, sqs and dynamodb handlers
 */
export type BatchResponse = { batchItemFailures: { itemIdentifier: string }[] }
