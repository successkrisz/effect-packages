import { assert, it } from '@effect/vitest'
import { Effect, Option, Result, Schema } from 'effect'
import { Distance } from 'effect-measure'
import * as DistanceModule from 'effect-measure/Distance'

it.effect('round-trips one mile as an exact string in a mixed-unit JSON struct', () =>
	Effect.gen(function* () {
		const Trip = Schema.fromJsonString(
			Schema.Struct({
				wholeMiles: Distance.FromMilesString,
				meters: DistanceModule.FromMetersString,
			}),
		)
		const json = '{"wholeMiles":"1","meters":"1609.344"}'
		const trip = yield* Schema.decodeEffect(Trip)(json)

		assert.isTrue(Distance.equals(trip.wholeMiles, trip.meters))
		assert.isTrue(Distance.equals(trip.wholeMiles, Option.getOrThrow(Distance.miles(1))))
		assert.strictEqual(yield* Schema.encodeEffect(Trip)(trip), json)
	}),
)

it.effect('canonicalizes zero and fractional miles with exact metric equivalents', () =>
	Effect.gen(function* () {
		const decode = Schema.decodeEffect(DistanceModule.FromMilesString)
		const encode = Schema.encodeEffect(DistanceModule.FromMilesString)
		const zero = yield* decode('0.00')
		const quarterMile = yield* decode('2.5e-1')
		const kilometers = yield* Schema.decodeEffect(Distance.FromKilometersString)('0.402336')

		assert.isTrue(Distance.equals(zero, Distance.zero))
		assert.strictEqual(yield* encode(zero), '0')
		assert.isTrue(Distance.equals(quarterMile, kilometers))
		assert.strictEqual(yield* encode(quarterMile), '0.25')
	}),
)

it('fails with a Schema issue when one meter would repeat in miles', () => {
	const meter = Option.getOrThrow(Distance.meters(1))
	assert.isTrue(Result.isFailure(Schema.encodeResult(Distance.FromMilesString)(meter)))
})

it.effect('preserves a terminating mile quotient beyond decimal division precision', () =>
	Effect.gen(function* () {
		const meters = (12_573n * (10n ** 110n + 1n)).toString()
		const distance = yield* Schema.decodeEffect(Distance.FromMetersString)(meters)
		const encoded = yield* Schema.encodeEffect(Distance.FromMilesString)(distance)
		const decoded = yield* Schema.decodeEffect(Distance.FromMilesString)(encoded)

		assert.isTrue(Distance.equals(distance, decoded))
	}),
)

it.effect('round-trips exact miles at the edge of the supported decimal scale', () =>
	Effect.gen(function* () {
		const distance = yield* Schema.decodeEffect(Distance.FromMetersString)('12573e-1000')
		const encoded = yield* Schema.encodeEffect(Distance.FromMilesString)(distance)
		const decoded = yield* Schema.decodeEffect(Distance.FromMilesString)(encoded)

		assert.strictEqual(encoded, '7.8125e-1000')
		assert.isTrue(Distance.equals(distance, decoded))
	}),
)

it('applies the same decimal syntax and scale validation to miles', () => {
	const decode = Schema.decodeUnknownResult(Distance.FromMilesString)
	for (const input of ['', '-1', '1.2.3', '1e1001', '1e-1005', '1e-1000', 1]) {
		assert.isTrue(Result.isFailure(decode(input)), JSON.stringify(input))
	}
})

it.effect('reports overflow when an exact mile value is too large for a number', () =>
	Effect.gen(function* () {
		const distance = yield* Schema.decodeEffect(Distance.FromMilesString)('1e500')
		assert.strictEqual(Distance.toMiles(distance), Number.POSITIVE_INFINITY)
		assert.isTrue(Result.isFailure(Schema.encodeResult(Distance.FromMiles)(distance)))
	}),
)
