import { assert, it } from '@effect/vitest'
import { Effect, Option, Result, Schema } from 'effect'
import { Distance } from 'effect-measure'
import * as DistanceModule from 'effect-measure/Distance'

it.effect('round-trips exact meter and kilometer fields above number precision', () =>
	Effect.gen(function* () {
		const Payload = Schema.fromJsonString(
			Schema.Struct({
				meters: Distance.FromMetersString,
				kilometers: DistanceModule.FromKilometersString,
			}),
		)
		const json = '{"meters":"9007199254740993","kilometers":"9007199254740.993"}'
		const payload = yield* Schema.decodeEffect(Payload)(json)

		assert.isTrue(Distance.equals(payload.meters, payload.kilometers))
		assert.isTrue(
			Distance.Order(
				payload.meters,
				yield* Schema.decodeEffect(Distance.FromMeters)(9007199254740992),
			) > 0,
		)
		assert.strictEqual(yield* Schema.encodeEffect(Payload)(payload), json)
	}),
)

it.effect('derives exact meter strings in JSON structs alongside explicit wire codecs', () =>
	Effect.gen(function* () {
		const Payload = Schema.fromJsonString(
			Schema.toCodecJson(
				Schema.Struct({
					derived: Distance.Schema,
					kilometers: Distance.FromKilometers,
					exact: DistanceModule.FromMetersString,
				}),
			),
		)
		const json = '{"derived":"0.000125","kilometers":0.000000125,"exact":"0.000125"}'
		const payload = yield* Schema.decodeEffect(Payload)(json)

		assert.isTrue(Distance.equals(payload.derived, payload.exact))
		assert.isTrue(Distance.equals(payload.derived, payload.kilometers))
		assert.strictEqual(
			yield* Schema.encodeEffect(Payload)(payload),
			'{"derived":"0.000125","kilometers":1.25e-7,"exact":"0.000125"}',
		)
	}),
)

it('rejects invalid decimal strings and unsupported scales as schema issues', () => {
	for (const codec of [Distance.FromMetersString, Distance.FromKilometersString]) {
		const decode = Schema.decodeUnknownResult(codec)
		for (const input of [
			'',
			' ',
			'-0',
			'-1',
			'+1',
			'1\n',
			'1e',
			'0x10',
			'1.2.3',
			'1e1001',
			'1e-1005',
			'1e9007199254740991',
			'1e-9007199254740991',
			1,
		]) {
			assert.isTrue(Result.isFailure(decode(input)), JSON.stringify(input))
		}
	}

	assert.isTrue(Result.isFailure(Schema.decodeResult(Distance.FromMetersString)('1e-1001')))
	assert.isTrue(Result.isFailure(Schema.decodeResult(Distance.FromKilometersString)('1e-1004')))
})

it.effect('preserves exact scale at the meter and kilometer wire boundaries', () =>
	Effect.gen(function* () {
		const meters = yield* Schema.decodeEffect(Distance.FromMetersString)('1e-1000')
		const kilometers = yield* Schema.decodeEffect(Distance.FromKilometersString)('1.0e-1003')
		assert.isTrue(Distance.equals(meters, kilometers))
		assert.strictEqual(yield* Schema.encodeEffect(Distance.FromMetersString)(kilometers), '1e-1000')
		assert.strictEqual(yield* Schema.encodeEffect(Distance.FromKilometersString)(meters), '1e-1003')
	}),
)

it.effect('encodes sums that would otherwise normalize to an unsupported scale', () =>
	Effect.gen(function* () {
		const decode = Schema.decodeEffect(Distance.FromMetersString)
		const leg = yield* decode('5e1000')
		const total = Distance.sum(leg, leg)
		const encoded = yield* Schema.encodeEffect(Distance.FromMetersString)(total)

		assert.strictEqual(encoded, `1${'0'.repeat(1_001)}`)
		assert.isTrue(Distance.equals(yield* decode(encoded), total))
		assert.strictEqual(Distance.toMeters(total), Number.POSITIVE_INFINITY)
		assert.isTrue(Result.isFailure(Schema.encodeResult(Distance.FromMeters)(total)))
	}),
)

it.effect('canonicalizes equivalent decimal text', () =>
	Effect.gen(function* () {
		for (const codec of [Distance.FromMetersString, Distance.FromKilometersString]) {
			const decode = Schema.decodeEffect(codec)
			const encode = Schema.encodeEffect(codec)
			const distance = yield* decode('001.000E+0')
			assert.isTrue(Distance.equals(distance, yield* decode('1')))
			assert.strictEqual(yield* encode(distance), '1')
		}
	}),
)

it.effect('round-trips the finite numeric constructor extremes in exact metric fields', () =>
	Effect.gen(function* () {
		for (const codec of [Distance.FromMetersString, Distance.FromKilometersString]) {
			const decode = Schema.decodeEffect(codec)
			const encode = Schema.encodeEffect(codec)
			for (const construct of [Distance.meters, Distance.kilometers, Distance.miles]) {
				for (const value of [0, Number.MIN_VALUE, Number.MAX_VALUE]) {
					const distance = Option.getOrThrow(construct(value))
					const encoded = yield* encode(distance)
					assert.isTrue(Distance.equals(distance, yield* decode(encoded)))
				}
			}
		}
	}),
)
