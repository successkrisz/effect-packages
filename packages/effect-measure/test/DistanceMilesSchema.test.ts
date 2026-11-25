import { assert, it } from '@effect/vitest'
import { Effect, Result, Schema } from 'effect'
import { Distance } from 'effect-measure'
import * as DistanceModule from 'effect-measure/Distance'

it.effect('round-trips numeric mile and meter fields in the same JSON payload', () =>
	Effect.gen(function* () {
		const Trip = Schema.fromJsonString(
			Schema.Struct({
				routeMiles: DistanceModule.FromMiles,
				remainingMeters: Distance.FromMeters,
			}),
		)
		const json = '{"routeMiles":1,"remainingMeters":1609.344}'
		const trip = yield* Schema.decodeEffect(Trip)(json)

		assert.isTrue(Distance.equals(trip.routeMiles, trip.remainingMeters))
		assert.strictEqual(yield* Schema.encodeEffect(Trip)(trip), json)
		assert.strictEqual(yield* Schema.encodeEffect(Distance.FromMiles)(trip.remainingMeters), 1)
	}),
)

it.effect('round-trips zero and both finite number extremes in miles', () =>
	Effect.gen(function* () {
		const decode = Schema.decodeEffect(Distance.FromMiles)
		const encode = Schema.encodeEffect(Distance.FromMiles)

		for (const value of [0, Number.MIN_VALUE, Number.MAX_VALUE]) {
			const distance = yield* decode(value)
			assert.strictEqual(yield* encode(distance), value)
		}
	}),
)

it('rejects invalid numeric mile fields with schema issues', () => {
	const decode = Schema.decodeUnknownResult(Distance.FromMiles)
	for (const value of [-1, Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY, '1']) {
		assert.isTrue(Result.isFailure(decode(value)))
	}
})

it.effect('encodes repeating and underflowing mile conversions as finite numbers', () =>
	Effect.gen(function* () {
		const oneMeter = yield* Schema.decodeEffect(Distance.FromMeters)(1)
		const tiny = yield* Schema.decodeEffect(Distance.FromMeters)(Number.MIN_VALUE)
		const encode = Schema.encodeEffect(Distance.FromMiles)

		assert.strictEqual(yield* encode(oneMeter), 0.0006213711922373339)
		assert.strictEqual(yield* encode(tiny), 0)
	}),
)

it.effect('rejects mile overflow with a schema issue', () =>
	Effect.gen(function* () {
		const leg = yield* Schema.decodeEffect(Distance.FromKilometers)(Number.MAX_VALUE)
		const total = Distance.sum(leg, leg)

		assert.isTrue(Result.isFailure(Schema.encodeResult(Distance.FromMiles)(total)))
	}),
)
