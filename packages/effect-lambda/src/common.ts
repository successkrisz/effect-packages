import type { Context as _Context } from 'aws-lambda'
import { Context } from 'effect'

export class HandlerContext extends Context.Tag(
	'@effect-lambda/HandlerContext',
)<HandlerContext, _Context>() {}

/**
 * shared type for various batch response types used in sns, sqs and dynamodb handlers
 */
export type BatchResponse = { batchItemFailures: { itemIdentifier: string }[] }
