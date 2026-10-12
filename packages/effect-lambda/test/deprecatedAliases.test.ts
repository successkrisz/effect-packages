import { describe, expect, it } from '@effect/vitest'
import { Effect } from 'effect'
import * as CustomAuthorizer from '../src/CustomAuthorizer'
import * as DynamoDb from '../src/DynamoDb'
import * as HttpApi from '../src/HttpApi'
import * as RestApi from '../src/RestApi'
import * as Sns from '../src/Sns'
import * as Sqs from '../src/Sqs'
import sqsEvent from './sampleEvents/sqsEvent.json'

describe('deprecated aliases', () => {
	it.each([
		['Sqs.SQSEvent', Sqs.SQSEvent, Sqs.SqsEvent],
		['Sqs.SQSRecord', Sqs.SQSRecord, Sqs.SqsRecord],
		['Sqs.SQSMessageBodies', Sqs.SQSMessageBodies, Sqs.messageBodies],
		['Sns.SNSEvent', Sns.SNSEvent, Sns.SnsEvent],
		['DynamoDb.DynamoDBStreamEvent', DynamoDb.DynamoDBStreamEvent, DynamoDb.DynamoDbStreamEvent],
		['DynamoDb.DynamoDBRecord', DynamoDb.DynamoDBRecord, DynamoDb.DynamoDbRecord],
		['DynamoDb.DynamoDBNewImages', DynamoDb.DynamoDBNewImages, DynamoDb.newImages],
		['RestApi.APIGatewayProxyEvent', RestApi.APIGatewayProxyEvent, RestApi.ApiGatewayProxyEvent],
		[
			'RestApi.NormalizedAPIGatewayProxyEvent',
			RestApi.NormalizedAPIGatewayProxyEvent,
			RestApi.normalizedEvent,
		],
		['RestApi.NormalizedHeaders', RestApi.NormalizedHeaders, RestApi.normalizedHeaders],
		[
			'HttpApi.APIGatewayProxyEventV2',
			HttpApi.APIGatewayProxyEventV2,
			HttpApi.ApiGatewayProxyEventV2,
		],
		[
			'HttpApi.NormalizedAPIGatewayProxyEventV2',
			HttpApi.NormalizedAPIGatewayProxyEventV2,
			HttpApi.normalizedEvent,
		],
		['HttpApi.NormalizedHeaders', HttpApi.NormalizedHeaders, HttpApi.normalizedHeaders],
		[
			'CustomAuthorizer.APIGatewayAuthorizerEvent',
			CustomAuthorizer.APIGatewayAuthorizerEvent,
			CustomAuthorizer.ApiGatewayAuthorizerEvent,
		],
	])('%s is the same value as its replacement', (_name, alias, replacement) => {
		expect(alias).toBe(replacement)
	})

	it.effect('a service provided through the old name is visible through the new name', () =>
		Effect.gen(function* () {
			const bodies = yield* Sqs.messageBodies.pipe(Effect.provideService(Sqs.SQSEvent, sqsEvent))
			expect(bodies).toEqual(sqsEvent.Records.map((record) => record.body))
		}),
	)

	it('uses namespaced service keys', () => {
		expect(Sqs.SqsEvent.key).toBe('effect-lambda/Sqs/SqsEvent')
		expect(RestApi.ApiGatewayProxyEvent.key).toBe('effect-lambda/RestApi/ApiGatewayProxyEvent')
	})
})
