/**
 * Services and types shared by all Lambda adapters.
 *
 * @since 1.0.0
 */
import { Context } from 'effect'
import type { LambdaContext } from './aws.ts'

/**
 * Service providing the AWS Lambda runtime `Context` of the current invocation.
 *
 * @since 1.0.0
 * @category services
 */
export class HandlerContext extends Context.Service<HandlerContext, LambdaContext>()(
	'effect-lambda/common/HandlerContext',
) {}

/**
 * Partial batch response returned by SQS, SNS and DynamoDB stream handlers to
 * report failed records.
 *
 * @since 1.0.0
 * @category models
 */
export type BatchResponse = { batchItemFailures: { itemIdentifier: string }[] }
