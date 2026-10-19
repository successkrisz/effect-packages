import * as HttpApiProblemDetail from '@ballatech/effect-problem-json/HttpApiProblemDetail'
import { Console, Effect, Layer, Schema, Stream } from 'effect'
import * as Csv from 'effect-csv/Csv'
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

const Point = Schema.Tuple([Schema.FiniteFromString, Schema.FiniteFromString])

export const csvPoints = Stream.make('1,2\n3,4\n').pipe(
	Stream.pipeThroughChannel(Csv.decodeSchemaString(Point)({ columns: 'none' })),
	Stream.runCollect,
)

export const csvDecoded = Stream.make('a,b\n1,2\n').pipe(
	Stream.pipeThroughChannel(Csv.decodeString({ delimiter: ',' })),
	Stream.runCollect,
)

export const csvEncoded = Stream.make(['a', 'b'], ['1', '2']).pipe(
	Stream.pipeThroughChannel(Csv.encode()),
	Stream.runCollect,
)

export const csvError = (u: unknown) => (Csv.isCsvError(u) ? u.reason._tag : undefined)
