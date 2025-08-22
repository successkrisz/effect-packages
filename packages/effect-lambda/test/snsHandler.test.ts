/** biome-ignore-all lint/suspicious/useIterableCallbackReturn: it's a test */
import { describe, expect, it } from '@effect/vitest'
import type { Context } from 'aws-lambda'
import { Effect, Layer } from 'effect'
import { HandlerContext } from '../src/common'
import { SNSEvent, toLambdaHandler } from '../src/Sns'
import event from './sampleEvents/snsEvent.json'

describe('snsHandler', () => {
	it('should return void on a successful effect', async () => {
		const actual = await toLambdaHandler(Effect.void)({ layer: Layer.empty })(
			event,
			{} as Context,
			() => {},
		)
		expect(actual).toBe(undefined)
	})

	it('should reject if the effect dies', async () => {
		const actual = toLambdaHandler(Effect.die('error'))({ layer: Layer.empty })(
			event,
			{} as Context,
			() => {},
		)

		await expect(actual).rejects.toBeDefined()
	})

	it('effect should have access to the event', async () => {
		const actual = toLambdaHandler(
			SNSEvent.pipe(
				Effect.map((_event) => {
					expect(_event).toEqual(event)
				}),
			),
		)({ layer: Layer.empty })(event, {} as Context, () => {})

		await expect(actual).resolves.toBe(undefined)
	})

	it('effect should have access to the context', async () => {
		const context = { functionName: 'foobar' } as Context
		const actual = toLambdaHandler(
			HandlerContext.pipe(
				Effect.map((_context) => {
					expect(_context).toEqual(context)
				}),
			),
		)({ layer: Layer.empty })(event, context, () => {
			expect(context).toEqual(context)
		})

		await expect(actual).resolves.toBe(undefined)
	})
})
