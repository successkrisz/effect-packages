import { assert, it } from '@effect/vitest'
import { Effect, Result, Schema } from 'effect'
import { Distance } from 'effect-measure'

const options = { disableChecks: true }

it('reports invalid numeric distances with checks disabled', () => {
	for (const codec of [Distance.FromMeters, Distance.FromKilometers, Distance.FromMiles]) {
		const decode = Schema.decodeUnknownResult(codec)
		for (const input of [-1, Number.NaN, Number.NEGATIVE_INFINITY, Number.POSITIVE_INFINITY]) {
			assert.isTrue(Result.isFailure(decode(input, options)), String(input))
		}
	}
})

it.effect('reports numeric overflow with checks disabled, including in JSON', () =>
	Effect.gen(function* () {
		const oversized = yield* Schema.decodeEffect(Distance.FromMilesString)('1e500')
		for (const codec of [Distance.FromMeters, Distance.FromKilometers, Distance.FromMiles]) {
			assert.isTrue(Result.isFailure(Schema.encodeResult(codec)(oversized, options)))
		}

		const Trip = Schema.fromJsonString(Schema.Struct({ miles: Distance.FromMiles }))
		assert.isTrue(Result.isFailure(Schema.encodeResult(Trip)({ miles: oversized }, options)))
	}),
)

it('rejects invalid syntax in exact and derived codecs with checks disabled', () => {
	for (const codec of [
		Distance.FromMetersString,
		Distance.FromKilometersString,
		Distance.FromMilesString,
		Schema.toCodecJson(Distance.Schema),
	]) {
		const decode = Schema.decodeUnknownResult(codec)
		for (const input of ['-1', '', '+1', '1.', '1e', '1.2.3']) {
			assert.isTrue(Result.isFailure(decode(input, options)), JSON.stringify(input))
		}
	}
})
