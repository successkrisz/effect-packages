import { Context, Effect } from 'effect'
import type { AwsDynamoDBRecord, AwsDynamoDBStreamEvent } from './aws'
import type { BatchResponse } from './common'
import { makeToHandler } from './makeToHandler'

/**
 * Context tag for the DynamoDB stream event.
 */
export class DynamoDBStreamEvent extends Context.Tag(
	'@effect-lambda/DynamoDBStreamEvent',
)<DynamoDBStreamEvent, AwsDynamoDBStreamEvent>() {}

/**
 * Context tag for a single DynamoDB record within a stream event.
 */
export class DynamoDBRecord extends Context.Tag(
	'@effect-lambda/DynamoDBRecord',
)<DynamoDBStreamEvent, AwsDynamoDBRecord>() {}

/**
 * Extract the `NewImage` values from each record in the DynamoDB stream event.
 */
export const DynamoDBNewImages = DynamoDBStreamEvent.pipe(
	Effect.map((event) =>
		event.Records.map((record) => record.dynamodb?.NewImage),
	),
)

/**
 * Convert an effectful program into a DynamoDB stream Lambda handler.
 */
export const toLambdaHandler = makeToHandler<
	typeof DynamoDBStreamEvent,
	// biome-ignore lint/suspicious/noConfusingVoidType: DDB handler return type is void | BatchResponse
	void | BatchResponse
>(DynamoDBStreamEvent)
