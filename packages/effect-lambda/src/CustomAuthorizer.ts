import { Context, Data, Effect, Layer, pipe } from 'effect'
import type {
	APIGatewayAuthorizerHandler,
	APIGatewayAuthorizerResult,
	AwsAPIGatewayAuthorizerEvent,
} from './aws'
import { HandlerContext } from './common'

/**
 * Export types from aws-lambda
 */
export type {
	APIGatewayAuthorizerHandler,
	APIGatewayAuthorizerResult,
	AwsAPIGatewayAuthorizerEvent,
}

/**
 * Context tag for API Gateway Request Authorizer events.
 *
 * Provides access to the raw `APIGatewayAuthorizerEvent` within effects.
 */
export class APIGatewayAuthorizerEvent extends Context.Tag(
	'@effect-lambda/APIGatewayAuthorizerEvent',
)<APIGatewayAuthorizerEvent, AwsAPIGatewayAuthorizerEvent>() {}

/**
 * Error signaling an authorization failure in a custom authorizer.
 */
export class UnauthorizedError extends Data.TaggedError(
	'@effect-lambda/UnauthorizedError',
) {}

/**
 * Convert an effectful authorization program into an `APIGatewayAuthorizerHandler`.
 *
 * The provided effect can access the incoming authorizer event via
 * `APIGatewayAuthorizerEvent` and the lambda context via `HandlerContext`.
 * If the effect fails with `UnauthorizedError`, API Gateway will receive a 401-like result.
 *
 * @param effect Effect that produces an `APIGatewayAuthorizerResult` or fails with `UnauthorizedError`.
 * @returns An `APIGatewayAuthorizerHandler` ready to be exported as `handler`.
 */
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
