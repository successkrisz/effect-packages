import type {
	DynamoDBRecord as _DynamoDBRecord,
	DynamoDBStreamEvent as _DynamoDBStreamEvent,
} from 'aws-lambda'
import { Context, Effect } from 'effect'
import type { BatchResponse } from './common'
import { makeToHandler } from './makeToHandler'

// Define a context tag for DynamoDBStreamEvent
export class DynamoDBStreamEvent extends Context.Tag(
	'@effect-lambda/DynamoDBStreamEvent',
)<DynamoDBStreamEvent, _DynamoDBStreamEvent>() {}

export class DynamoDBRecord extends Context.Tag(
	'@effect-lambda/DynamoDBRecord',
)<DynamoDBStreamEvent, _DynamoDBRecord>() {}

// Utility to extract the new images from the DynamoDB stream event
export const DynamoDBNewImages = DynamoDBStreamEvent.pipe(
	Effect.map((event) =>
		event.Records.map((record) => record.dynamodb?.NewImage),
	),
)

// Define the DynamoDBStreamEventHandler
export const toLambdaHandler = makeToHandler<
	typeof DynamoDBStreamEvent,
	// biome-ignore lint/suspicious/noConfusingVoidType: DDB handler return type is void | BatchResponse
	void | BatchResponse
>(DynamoDBStreamEvent)
