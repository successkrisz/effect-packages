import { Context, Data, Effect, Layer, pipe } from 'effect'
import type {
	APIGatewayAuthorizerHandler,
	APIGatewayAuthorizerResult,
	AwsAPIGatewayAuthorizerEvent,
} from './aws'
import { HandlerContext } from './common'

export class APIGatewayAuthorizerEvent extends Context.Tag(
	'@effect-lambda/APIGatewayAuthorizerEvent',
)<APIGatewayAuthorizerEvent, AwsAPIGatewayAuthorizerEvent>() {}

export class UnauthorizedError extends Data.TaggedError(
	'@effect-lambda/UnauthorizedError',
) {}

export const toLambdaHandler =
	(
		effect: Effect.Effect<
			APIGatewayAuthorizerResult,
			UnauthorizedError,
			APIGatewayAuthorizerEvent | HandlerContext
		>,
	): APIGatewayAuthorizerHandler =>
	(event, context) =>
		pipe(
			effect,
			Effect.provide(
				Layer.provideMerge(
					Layer.sync(APIGatewayAuthorizerEvent, () => event),
					Layer.sync(HandlerContext, () => context),
				),
			),
			Effect.runPromise,
		)
