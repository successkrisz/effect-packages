/** biome-ignore-all lint/suspicious/useIterableCallbackReturn: it's a test */
import { describe, expect, it } from '@effect/vitest'
import type { Context } from 'aws-lambda'
import { Effect, Layer } from 'effect'
import { HandlerContext } from '../src/common'
import {
	recordProcessorAdapter,
	SQSEvent,
	SQSMessageBodies,
	SQSRecord,
	toLambdaHandler,
} from '../src/Sqs'
import event from './sampleEvents/sqsEvent.json'

describe('sqsHandler', () => {
	it('should return void on an successful effect', async () => {
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
			SQSEvent.pipe(
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

	it('should have access to the MessageBodies', async () => {
		const actual = toLambdaHandler(
			SQSMessageBodies.pipe(
				Effect.map((messageBodies) => {
					expect(messageBodies).toEqual(event.Records.map((r) => r.body))
				}),
			),
		)({ layer: Layer.empty })(event, {} as Context, () => {})

		await expect(actual).resolves.toBe(undefined)
	})

	it('should process each record and return a batch response', async () => {
		const processRecord = SQSRecord.pipe(
			Effect.tap((record) => {
				expect(record.body).toBeDefined()
			}),
			Effect.asVoid,
		)

		const result = await processRecord.pipe(
			recordProcessorAdapter,
			Effect.provideService(SQSEvent, event),
			(eff) => toLambdaHandler(eff),
		)({ layer: Layer.empty })(event, {} as Context, () => {})

		expect(result).toEqual({
			batchItemFailures: [],
		})
	})

	it('should return batchItemFailures for failed records', async () => {
		const processRecord = SQSRecord.pipe(
			Effect.flatMap((record) =>
				record.body === 'fail' ? Effect.fail('Processing failed') : Effect.succeed(undefined),
			),
		)

		const modifiedEvent = {
			...event,
			Records: [...event.Records, { ...event.Records[0], body: 'fail', messageId: 'fail-id' }],
		}

		const result = await processRecord.pipe(
			recordProcessorAdapter,
			Effect.provideService(SQSEvent, modifiedEvent),
			(eff) => toLambdaHandler(eff),
		)({ layer: Layer.empty })(event, {} as Context, () => {})

		expect(result).toEqual({
			batchItemFailures: [{ itemIdentifier: 'fail-id' }],
		})
	})
})
