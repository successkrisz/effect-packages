import * as HttpApiProblemDetail from '@ballatech/effect-problem-json/HttpApiProblemDetail'
import { Console, Effect, Layer } from 'effect'
import * as CustomAuthorizer from 'effect-lambda/CustomAuthorizer'
import * as DynamoDb from 'effect-lambda/DynamoDb'
import * as HttpApi from 'effect-lambda/HttpApi'
import * as HttpResponse from 'effect-lambda/HttpResponse'
import * as RestApi from 'effect-lambda/RestApi'
import * as Sns from 'effect-lambda/Sns'
import * as Sqs from 'effect-lambda/Sqs'

export const restApiHandler = RestApi.toLambdaHandler(
	RestApi.normalizedEvent.pipe(Effect.flatMap((event) => HttpResponse.ok({ body: event.headers }))),
)({ layer: Layer.empty })

export const httpApiHandler = HttpApi.toLambdaHandler(Effect.succeed(HttpResponse.noContent()))({
	layer: Layer.empty,
})

export const sqsHandler = Sqs.toLambdaHandler(Sqs.messageBodies.pipe(Effect.asVoid))({
	layer: Layer.empty,
})

export const sqsRecordHandler = Sqs.toLambdaHandler(
	Sqs.SqsRecord.use(() => Effect.void).pipe(Sqs.recordProcessorAdapter),
)({ layer: Layer.empty })

export const sqsRecordDocExampleHandler = Sqs.toLambdaHandler(
	Sqs.SqsRecord.use((record) => Console.log(record.body)).pipe(Sqs.recordProcessorAdapter),
)()

export const snsHandler = Sns.toLambdaHandler(Sns.SnsEvent.use(() => Effect.void))({
	layer: Layer.empty,
})

export const dynamoDbHandler = DynamoDb.toLambdaHandler(DynamoDb.newImages.pipe(Effect.asVoid))({
	layer: Layer.empty,
})

export const authorizerHandler = CustomAuthorizer.toLambdaHandler(
	CustomAuthorizer.ApiGatewayAuthorizerEvent.use(() =>
		Effect.fail(new CustomAuthorizer.UnauthorizedError()),
	),
)

export const notFound = new HttpApiProblemDetail.NotFound({ detail: 'missing' })
