/** biome-ignore-all lint/suspicious/useIterableCallbackReturn: it's a test */
import { describe, expect, it } from '@effect/vitest'
import type {
	DynamoDBStreamEvent as _DynamoDBStreamEvent,
	Context,
} from 'aws-lambda'
import { Effect, Layer } from 'effect'
import { HandlerContext } from '../src/common'
import {
	DynamoDBNewImages,
	DynamoDBStreamEvent,
	toLambdaHandler as DynamoDBStreamEventHandler,
} from '../src/DynamoDb'
import event from './sampleEvents/ddbEvent.json'

describe('ddbHandler', () => {
	it('should return void on a successful effect', async () => {
		const actual = await DynamoDBStreamEventHandler(Effect.void)({
			layer: Layer.empty,
		})(event as _DynamoDBStreamEvent, {} as Context, () => {})
		expect(actual).toBe(undefined)
	})

	it('should reject if the effect dies', async () => {
		const actual = DynamoDBStreamEventHandler(Effect.die('error'))({
			layer: Layer.empty,
		})(event as _DynamoDBStreamEvent, {} as Context, () => {})

		await expect(actual).rejects.toBeDefined()
	})

	it('effect should have access to the event', async () => {
		const actual = DynamoDBStreamEventHandler(
			DynamoDBStreamEvent.pipe(
				Effect.map((_event) => {
					expect(_event).toEqual(event)
				}),
			),
		)({ layer: Layer.empty })(
			event as _DynamoDBStreamEvent,
			{} as Context,
			() => {},
		)

		await expect(actual).resolves.toBe(undefined)
	})

	it('effect should have access to the context', async () => {
		const context = { functionName: 'foobar' } as Context
		const actual = DynamoDBStreamEventHandler(
			HandlerContext.pipe(
				Effect.map((_context) => {
					expect(_context).toEqual(context)
				}),
			),
		)({ layer: Layer.empty })(event as _DynamoDBStreamEvent, context, () => {
			expect(context).toEqual(context)
		})

		await expect(actual).resolves.toBe(undefined)
	})

	it('should have access to the NewImages', async () => {
		const actual = DynamoDBStreamEventHandler(
			DynamoDBNewImages.pipe(
				Effect.map((newImages) => {
					expect(newImages).toEqual(
						event.Records.map((r) => r.dynamodb?.NewImage),
					)
				}),
			),
		)({ layer: Layer.empty })(
			event as _DynamoDBStreamEvent,
			{} as Context,
			() => {},
		)

		await expect(actual).resolves.toBe(undefined)
	})
})
