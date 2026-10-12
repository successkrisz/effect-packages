import { OAuthHttpClient } from '@ballatech/effect-oauth-client'
import { HttpApiProblemDetail } from '@ballatech/effect-problem-json'
import { Config, Effect, Layer, Schema } from 'effect'
import {
	applyMiddleware,
	CustomAuthorizer,
	DynamoDb,
	HandlerContext,
	HttpApi,
	HttpResponse,
	RestApi,
	Sns,
	Sqs,
} from 'effect-lambda'

export const restApiHandler = RestApi.toLambdaHandler(
	RestApi.schemaBodyJson(Schema.Struct({ name: Schema.String })).pipe(
		Effect.flatMap((body) => HttpResponse.ok({ body })),
		Effect.catchTag('SchemaError', HttpResponse.badRequestFromSchemaError),
		Effect.map(applyMiddleware((_req, res, next) => next(res.setHeader('x-test', '1')))),
	),
)({ layer: Layer.empty })

export const httpApiHandler = HttpApi.toLambdaHandler(
	HttpApi.normalizedHeaders.pipe(Effect.flatMap((headers) => HttpResponse.ok({ body: headers }))),
)({ layer: Layer.empty })

export const lambdaContext = HandlerContext.useSync((context) => context)

export const sqsHandler = Sqs.toLambdaHandler(Sqs.messageBodies.pipe(Effect.asVoid))({
	layer: Layer.empty,
})

export const snsHandler = Sns.toLambdaHandler(Effect.void)({ layer: Layer.empty })

export const dynamoDbHandler = DynamoDb.toLambdaHandler(DynamoDb.newImages.pipe(Effect.asVoid))({
	layer: Layer.empty,
})

export const authorizerHandler = CustomAuthorizer.toLambdaHandler(
	CustomAuthorizer.ApiGatewayAuthorizerEvent.use(() =>
		Effect.fail(new CustomAuthorizer.UnauthorizedError()),
	),
)

export const oauthLayer = OAuthHttpClient.layerConfig({
	tokenUrl: Config.String('TOKEN_URL'),
	clientId: Config.String('CLIENT_ID'),
	clientSecret: Config.Redacted('CLIENT_SECRET'),
})

export class DuplicateTitle extends HttpApiProblemDetail.ProblemError(
	'DuplicateTitle',
	422,
)({
	existingId: Schema.Number,
}) {}

export const problemMiddleware = HttpApiProblemDetail.middleware()
