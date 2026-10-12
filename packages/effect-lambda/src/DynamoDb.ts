/**
 * Adapters for Lambda functions triggered by DynamoDB streams.
 *
 * The incoming `DynamoDBStreamEvent` is provided to the program through the
 * `DynamoDbStreamEvent` service.
 *
 * @since 1.0.0
 */
import { Context } from 'effect'
import type { AwsDynamoDBRecord, AwsDynamoDBStreamEvent, Handler } from './aws.ts'
import type { BatchResponse } from './common.ts'
import { makeToHandler } from './makeToHandler.ts'

export type {
	/**
	 * @since 1.0.0
	 * @category models
	 */
	AwsDynamoDBRecord,
	/**
	 * @since 1.0.0
	 * @category models
	 */
	AwsDynamoDBStreamEvent,
	// Lets emitted declarations of `toLambdaHandler` name `Handler` via this module instead of
	// the unresolvable `aws-lambda/handler` subpath.
	/**
	 * @since 1.0.0
	 * @category models
	 */
	Handler,
}

/**
 * Service providing the incoming DynamoDB stream event.
 *
 * @since 1.0.0
 * @category services
 */
export class DynamoDbStreamEvent extends Context.Service<
	DynamoDbStreamEvent,
	AwsDynamoDBStreamEvent
>()('effect-lambda/DynamoDb/DynamoDbStreamEvent') {}

/**
 * Service providing a single record of a DynamoDB stream event.
 *
 * @since 1.0.0
 * @category services
 */
export class DynamoDbRecord extends Context.Service<DynamoDbRecord, AwsDynamoDBRecord>()(
	'effect-lambda/DynamoDb/DynamoDbRecord',
) {}

/**
 * The `NewImage` of each record in the DynamoDB stream event.
 *
 * @since 1.0.0
 * @category accessors
 */
export const newImages = DynamoDbStreamEvent.useSync((event) =>
	event.Records.map((record) => record.dynamodb?.NewImage),
)

/**
 * Convert an effectful program into a DynamoDB stream Lambda handler.
 *
 * @example
 * ```ts
 * import { DynamoDb } from 'effect-lambda'
 * import { Effect } from 'effect'
 *
 * export const handler = DynamoDb.toLambdaHandler(
 *   DynamoDb.newImages.pipe(Effect.flatMap((images) => Effect.log(images))),
 * )()
 * ```
 *
 * @since 1.0.0
 * @category converting
 */
export const toLambdaHandler = makeToHandler<
	typeof DynamoDbStreamEvent,
	// biome-ignore lint/suspicious/noConfusingVoidType: DDB handler return type is void | BatchResponse
	void | BatchResponse
>(DynamoDbStreamEvent)

/**
 * @deprecated Use `DynamoDbStreamEvent`.
 * @since 1.0.0
 * @category services
 */
export const DynamoDBStreamEvent = DynamoDbStreamEvent
/**
 * @deprecated Use `DynamoDbStreamEvent`.
 * @since 1.0.0
 * @category services
 */
export type DynamoDBStreamEvent = DynamoDbStreamEvent

/**
 * @deprecated Use `DynamoDbRecord`.
 * @since 1.0.0
 * @category services
 */
export const DynamoDBRecord = DynamoDbRecord
/**
 * @deprecated Use `DynamoDbRecord`.
 * @since 1.0.0
 * @category services
 */
export type DynamoDBRecord = DynamoDbRecord

/**
 * @deprecated Use `newImages`.
 * @since 1.0.0
 * @category accessors
 */
export const DynamoDBNewImages = newImages
