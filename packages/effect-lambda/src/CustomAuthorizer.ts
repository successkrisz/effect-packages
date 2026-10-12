/**
 * Adapter for API Gateway custom (request) authorizer Lambda functions.
 *
 * The incoming authorizer event is provided to the program through the
 * `ApiGatewayAuthorizerEvent` service. Failing with `UnauthorizedError` rejects
 * the request.
 *
 * @since 1.0.0
 */
import { Context, Data, Effect, Layer, pipe } from 'effect'
import type {
	APIGatewayAuthorizerHandler,
	APIGatewayAuthorizerResult,
	AwsAPIGatewayAuthorizerEvent,
} from './aws.ts'
import { HandlerContext } from './common.ts'

export type {
	/**
	 * @since 1.0.0
	 * @category models
	 */
	APIGatewayAuthorizerHandler,
	/**
	 * @since 1.0.0
	 * @category models
	 */
	APIGatewayAuthorizerResult,
	/**
	 * @since 1.0.0
	 * @category models
	 */
	AwsAPIGatewayAuthorizerEvent,
}

/**
 * Service providing the incoming API Gateway authorizer event.
 *
 * @since 1.0.0
 * @category services
 */
export class ApiGatewayAuthorizerEvent extends Context.Service<
	ApiGatewayAuthorizerEvent,
	AwsAPIGatewayAuthorizerEvent
>()('effect-lambda/CustomAuthorizer/ApiGatewayAuthorizerEvent') {}

/**
 * Error signaling that the request is not authorized.
 *
 * @since 1.0.0
 * @category errors
 */
export class UnauthorizedError extends Data.TaggedError('LambdaUnauthorizedError') {}

/**
 * Convert an effectful authorization program into an `APIGatewayAuthorizerHandler`.
 *
 * The program can access the authorizer event through `ApiGatewayAuthorizerEvent`
 * and the Lambda context through `HandlerContext`. If it fails with
 * `UnauthorizedError`, the handler rejects and API Gateway denies the request.
 *
 * @example
 * ```ts
 * import { CustomAuthorizer } from 'effect-lambda'
 * import { Effect } from 'effect'
 *
 * export const handler = CustomAuthorizer.toLambdaHandler(
 *   CustomAuthorizer.ApiGatewayAuthorizerEvent.use((event) =>
 *     event.type === 'REQUEST'
 *       ? Effect.succeed({
 *           principalId: 'user',
 *           policyDocument: {
 *             Version: '2012-10-17',
 *             Statement: [{ Action: 'execute-api:Invoke', Effect: 'Allow', Resource: event.methodArn }],
 *           },
 *         })
 *       : Effect.fail(new CustomAuthorizer.UnauthorizedError()),
 *   ),
 * )
 * ```
 *
 * @since 1.0.0
 * @category converting
 */
export const toLambdaHandler =
	(
		effect: Effect.Effect<
			APIGatewayAuthorizerResult,
			UnauthorizedError,
			ApiGatewayAuthorizerEvent | HandlerContext
		>,
	): APIGatewayAuthorizerHandler =>
	(event, context) =>
		pipe(
			effect,
			// @effect-diagnostics-next-line strictEffectProvide:off -- Lambda handler IS the application entry point; the runtime invokes this function per-request
			Effect.provide(
				Layer.provideMerge(
					Layer.sync(ApiGatewayAuthorizerEvent, () => event),
					Layer.sync(HandlerContext, () => context),
				),
			),
			Effect.runPromise,
		)

/**
 * @deprecated Use `ApiGatewayAuthorizerEvent`.
 * @since 1.0.0
 * @category services
 */
export const APIGatewayAuthorizerEvent = ApiGatewayAuthorizerEvent
/**
 * @deprecated Use `ApiGatewayAuthorizerEvent`.
 * @since 1.0.0
 * @category services
 */
export type APIGatewayAuthorizerEvent = ApiGatewayAuthorizerEvent
