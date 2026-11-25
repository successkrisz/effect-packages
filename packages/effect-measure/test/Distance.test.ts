import { assert, it } from '@effect/vitest'
import { Option } from 'effect'
import { Distance } from 'effect-measure'

it('compares a route length in meters with a kilometer threshold and displays all three units', () => {
	const route = Option.getOrThrow(Distance.meters(1750))
	const threshold = Option.getOrThrow(Distance.kilometers(2))

	assert.strictEqual(Distance.Order(route, threshold), -1)
	assert.strictEqual(Distance.toKilometers(route), 1.75)
	assert.strictEqual(Distance.toMeters(threshold), 2000)
	assert.strictEqual(Distance.toMiles(route), 1.0873995864153345)
})

it('accepts zero and rejects negative and non-finite lengths in all three units', () => {
	for (const construct of [Distance.meters, Distance.kilometers, Distance.miles]) {
		assert.strictEqual(Distance.toMeters(Option.getOrThrow(construct(0))), 0)
		for (const value of [
			-1,
			-1e-7,
			Number.NaN,
			Number.POSITIVE_INFINITY,
			Number.NEGATIVE_INFINITY,
		]) {
			assert.isTrue(Option.isNone(construct(value)), `Expected ${value} to be rejected`)
		}
	}

	assert.strictEqual(Distance.toMiles(Option.getOrThrow(Distance.miles(0))), 0)
})

it('preserves submillimeter precision across meters and kilometers', () => {
	const below = Option.getOrThrow(Distance.meters(0.50049))
	const at = Option.getOrThrow(Distance.meters(0.5005))
	const above = Option.getOrThrow(Distance.meters(0.50051))

	assert.strictEqual(Distance.toMeters(at), 0.5005)
	assert.strictEqual(Distance.Order(below, at), -1)
	assert.strictEqual(Distance.Order(at, above), -1)

	const tinyKilometers = Option.getOrThrow(Distance.kilometers(5e-7))
	const tinyMeters = Option.getOrThrow(Distance.meters(0.0005))
	assert.strictEqual(Distance.toMeters(tinyKilometers), 0.0005)
	assert.isTrue(Distance.equals(tinyKilometers, tinyMeters))
	assert.strictEqual(Distance.Order(tinyKilometers, tinyMeters), 0)
})

it('preserves fractional miles when converting to meters', () => {
	const distance = Option.getOrThrow(Distance.miles(0.00390625))

	assert.strictEqual(Distance.toMeters(distance), 6.2865)
	assert.strictEqual(Distance.toMiles(distance), 0.00390625)
})

it('accepts and orders finite distances on both sides of the former millimeter cap', () => {
	const below = Option.getOrThrow(Distance.meters(9_007_199_254_740.99))
	const above = Option.getOrThrow(Distance.meters(9_007_199_254_740.992))
	const equivalent = Option.getOrThrow(Distance.kilometers(9_007_199_254.740992))

	assert.strictEqual(Distance.toMeters(below), 9_007_199_254_740.99)
	assert.strictEqual(Distance.toMeters(above), 9_007_199_254_740.992)
	assert.strictEqual(Distance.Order(below, above), -1)
	assert.isTrue(Distance.equals(above, equivalent))
	assert.strictEqual(Distance.Order(above, equivalent), 0)
})

it('compares equivalent lengths and sorts distances across all three units', () => {
	const mile = Option.getOrThrow(Distance.miles(1))
	const meters = Option.getOrThrow(Distance.meters(1_609.344))
	const kilometers = Option.getOrThrow(Distance.kilometers(1.609344))

	for (const equivalent of [meters, kilometers]) {
		assert.isTrue(Distance.equals(mile, equivalent))
		assert.strictEqual(Distance.Order(mile, equivalent), 0)
		assert.strictEqual(Distance.toMiles(equivalent), 1)
	}

	assert.strictEqual(Distance.toMeters(mile), 1_609.344)
	assert.strictEqual(Distance.toKilometers(mile), 1.609344)

	const shorter = Option.getOrThrow(Distance.kilometers(1.5))
	const longer = Option.getOrThrow(Distance.meters(1_609.3441))
	assert.isFalse(Distance.equals(mile, longer))
	const sorted = [longer, shorter, mile].sort(Distance.Order)

	assert.strictEqual(sorted[0], shorter)
	assert.strictEqual(sorted[1], mile)
	assert.strictEqual(sorted[2], longer)
})

it('compares distances whose numeric meter conversions coincide', () => {
	const shorter = Option.getOrThrow(Distance.meters(100.00000000000001))
	const longer = Option.getOrThrow(Distance.kilometers(0.10000000000000002))

	assert.strictEqual(Distance.toMeters(shorter), Distance.toMeters(longer))
	assert.isFalse(Distance.equals(shorter, longer))
	assert.strictEqual(Distance.Order(shorter, longer), -1)
	assert.strictEqual(Distance.Order(longer, shorter), 1)
})

it('preserves positive distances in every unit at the smallest positive input', () => {
	const zero = Option.getOrThrow(Distance.meters(0))
	const meters = Option.getOrThrow(Distance.meters(Number.MIN_VALUE))
	const kilometers = Option.getOrThrow(Distance.kilometers(Number.MIN_VALUE))
	const miles = Option.getOrThrow(Distance.miles(Number.MIN_VALUE))

	assert.strictEqual(Distance.toMeters(meters), Number.MIN_VALUE)
	assert.strictEqual(Distance.toKilometers(kilometers), Number.MIN_VALUE)
	assert.strictEqual(Distance.toMiles(miles), Number.MIN_VALUE)
	assert.strictEqual(Distance.toKilometers(meters), 0)
	assert.strictEqual(Distance.toMiles(meters), 0)
	for (const positive of [meters, kilometers, miles]) {
		assert.isFalse(Distance.equals(positive, zero))
		assert.strictEqual(Distance.Order(positive, zero), 1)
	}
})

it('converts maximum inputs back to their source units and compares them after meter overflow', () => {
	const meters = Option.getOrThrow(Distance.meters(Number.MAX_VALUE))
	const kilometers = Option.getOrThrow(Distance.kilometers(Number.MAX_VALUE))
	const miles = Option.getOrThrow(Distance.miles(Number.MAX_VALUE))

	assert.strictEqual(Distance.toMeters(meters), Number.MAX_VALUE)
	assert.strictEqual(Distance.toKilometers(kilometers), Number.MAX_VALUE)
	assert.strictEqual(Distance.toMiles(miles), Number.MAX_VALUE)
	assert.strictEqual(Distance.toMeters(kilometers), Number.POSITIVE_INFINITY)
	assert.strictEqual(Distance.toMeters(miles), Number.POSITIVE_INFINITY)
	assert.isFalse(Distance.equals(kilometers, miles))
	assert.strictEqual(Distance.Order(meters, kilometers), -1)
	assert.strictEqual(Distance.Order(kilometers, miles), -1)
})
