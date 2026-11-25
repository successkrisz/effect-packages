import { assert, it } from '@effect/vitest'
import { Effect, Option, Result, Schema } from 'effect'
import { Distance } from 'effect-measure'
import * as DistanceModule from 'effect-measure/Distance'

it.effect('round-trips JSON fields in meters and kilometers', () =>
	Effect.gen(function* () {
		const Trip = Schema.fromJsonString(
			Schema.Struct({
				routeKm: Distance.FromKilometers,
				remainingMeters: DistanceModule.FromMeters,
			}),
		)
		const json = '{"routeKm":1.234,"remainingMeters":1234}'
		const trip = yield* Schema.decodeEffect(Trip)(json)

		assert.isTrue(Distance.equals(trip.routeKm, trip.remainingMeters))
		assert.strictEqual(yield* Schema.encodeEffect(Trip)(trip), json)
		assert.strictEqual(yield* Schema.encodeEffect(Distance.FromMeters)(trip.routeKm), 1234)
		assert.strictEqual(
			yield* Schema.encodeEffect(DistanceModule.FromKilometers)(trip.remainingMeters),
			1.234,
		)
	}),
)

it.effect('validates only branded distance values with the domain schema', () =>
	Effect.gen(function* () {
		for (const construct of [Distance.meters, Distance.kilometers, Distance.miles]) {
			const distance = Option.getOrThrow(construct(1))
			assert.isTrue(DistanceModule.isDistance(distance))
			assert.strictEqual(yield* Schema.decodeEffect(Distance.Schema)(distance), distance)
		}

		const distance = Option.getOrThrow(Distance.meters(1))
		const imitation: unknown = Object.create(Object.getPrototypeOf(distance))
		const decode = Schema.decodeUnknownResult(DistanceModule.Schema)
		for (const input of [undefined, null, 1, { meters: 1 }, imitation]) {
			assert.isFalse(Distance.isDistance(input))
			assert.isTrue(Result.isFailure(decode(input)))
		}
	}),
)

it.effect('keeps fractional meter precision and accepts the finite number extremes', () =>
	Effect.gen(function* () {
		const fractionalMeters = yield* Schema.decodeEffect(Distance.FromMeters)(0.000125)
		const fractionalKilometers = yield* Schema.decodeEffect(Distance.FromKilometers)(0.000000125)

		assert.isTrue(Distance.equals(fractionalMeters, fractionalKilometers))
		assert.strictEqual(
			yield* Schema.encodeEffect(Distance.FromMeters)(fractionalKilometers),
			0.000125,
		)

		for (const codec of [Distance.FromMeters, Distance.FromKilometers]) {
			const decode = Schema.decodeEffect(codec)
			const encode = Schema.encodeEffect(codec)
			for (const value of [0, Number.MIN_VALUE, Number.MAX_VALUE]) {
				const distance = yield* decode(value)
				assert.strictEqual(yield* encode(distance), value)
			}
		}
	}),
)

it('rejects invalid numeric inputs with schema issues', () => {
	for (const codec of [Distance.FromMeters, Distance.FromKilometers]) {
		const decode = Schema.decodeUnknownResult(codec)
		for (const value of [-1, Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY, '1']) {
			assert.isTrue(Result.isFailure(decode(value)))
		}
	}
})

it.effect('reports metric overflow and allows underflow to zero when encoding', () =>
	Effect.gen(function* () {
		const large = yield* Schema.decodeEffect(Distance.FromKilometers)(Number.MAX_VALUE)
		const tiny = yield* Schema.decodeEffect(Distance.FromMeters)(Number.MIN_VALUE)

		assert.isTrue(Result.isFailure(Schema.encodeResult(Distance.FromMeters)(large)))
		assert.strictEqual(yield* Schema.encodeEffect(Distance.FromKilometers)(tiny), 0)
	}),
)
