import { describe, expect, it } from '@effect/vitest'
import type { APIGatewayAuthorizerEvent, APIGatewayAuthorizerResult, Context } from 'aws-lambda'
import { Effect } from 'effect'
import {
	toLambdaHandler as CustomAuthorizerHandler,
	UnauthorizedError,
} from '../src/CustomAuthorizer'
import event from './sampleEvents/request-authorizer.json'

describe('toHandler', () => {
	const mockContext = {} as Context

	it('should return a successful authorization result', async () => {
		const response: APIGatewayAuthorizerResult = {
			principalId: 'user123', // Unique identifier for the user
			policyDocument: {
				Version: '2012-10-17', // IAM policy version
				Statement: [
					{
						Action: 'execute-api:Invoke', // Action allowed
						Effect: 'Allow', // Allow or Deny
						Resource: 'arn:aws:execute-api:region:account-id:api-id/stage/METHOD/resource-path', // Resource ARN
					},
				],
			},
			context: {
				// Optional context object
				stringKey: 'value',
				numberKey: 123,
				booleanKey: true,
			},
			usageIdentifierKey: 'usage-key', // Optional usage identifier key
		}

		const effect = Effect.succeed(response)

		const handler = effect.pipe(CustomAuthorizerHandler)

		return expect(
			await handler(event as unknown as APIGatewayAuthorizerEvent, mockContext, () => {}),
		).toEqual(response)
	})

	it('should throw UnauthorizedError for unauthorized access', async () => {
		const effect = Effect.fail(new UnauthorizedError()) as unknown as Parameters<
			typeof CustomAuthorizerHandler
		>[0]

		const handler = effect.pipe(CustomAuthorizerHandler)

		return expect(
			handler(event as unknown as APIGatewayAuthorizerEvent, mockContext, () => {}),
		).rejects.toThrow()
	})
})
