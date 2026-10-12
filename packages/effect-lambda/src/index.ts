/**
 * @since 1.0.0
 */

/**
 * @since 1.0.0
 */
export * from './applyMiddleware.ts'

// Consumers' inferred handler types reference aws-lambda; without these re-exports their
// declaration emit fails with "cannot be named without a reference to @types/aws-lambda".
/**
 * @since 1.0.0
 */
export type * from './aws.ts'

/**
 * @since 1.0.0
 */
export * as CustomAuthorizer from './CustomAuthorizer.ts'

export {
	/**
	 * @since 1.0.0
	 */
	type BatchResponse,
	/**
	 * @since 1.0.0
	 */
	HandlerContext,
} from './common.ts'

/**
 * @since 1.0.0
 */
export * as DynamoDb from './DynamoDb.ts'

/**
 * @since 1.0.0
 */
export * as HttpApi from './HttpApi.ts'

/**
 * @since 1.0.0
 */
export * as HttpResponse from './HttpResponse.ts'

export {
	/**
	 * @since 1.0.0
	 */
	makeToHandler,
} from './makeToHandler.ts'

/**
 * @since 1.0.0
 */
export * as RestApi from './RestApi.ts'

/**
 * @since 1.0.0
 */
export * as Sns from './Sns.ts'

/**
 * @since 1.0.0
 */
export * as Sqs from './Sqs.ts'

export type {
	/**
	 * @since 1.0.0
	 */
	ToEffect,
} from './utils.ts'
