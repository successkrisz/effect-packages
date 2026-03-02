import { ServiceMap } from 'effect'
import type { AwsDynamoDBRecord, AwsDynamoDBStreamEvent } from './aws.ts'
import type { BatchResponse } from './common.ts'
import { makeToHandler } from './makeToHandler.ts'

/**
 * Export types from aws-lambda
 */
export type { AwsDynamoDBRecord, AwsDynamoDBStreamEvent }

/**
 * Context tag for the DynamoDB stream event.
 */
export class DynamoDBStreamEvent extends ServiceMap.Service<
	DynamoDBStreamEvent,
	AwsDynamoDBStreamEvent
>()('@effect-lambda/DynamoDBStreamEvent') {}

/**
 * Context tag for a single DynamoDB record within a stream event.
 */
export class DynamoDBRecord extends ServiceMap.Service<DynamoDBRecord, AwsDynamoDBRecord>()(
	'@effect-lambda/DynamoDBRecord',
) {}

/**
 * Extract the `NewImage` values from each record in the DynamoDB stream event.
 */
export const DynamoDBNewImages = DynamoDBStreamEvent.useSync((event) =>
	event.Records.map((record) => record.dynamodb?.NewImage),
)

/**
 * Convert an effectful program into a DynamoDB stream Lambda handler.
 */
export const toLambdaHandler = makeToHandler<
	typeof DynamoDBStreamEvent,
	// biome-ignore lint/suspicious/noConfusingVoidType: DDB handler return type is void | BatchResponse
	void | BatchResponse
>(DynamoDBStreamEvent)
