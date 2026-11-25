import { assert, it } from '@effect/vitest'
import { Option } from 'effect'
import { Distance } from 'effect-measure'

it('compares a route length in meters with a kilometer threshold and displays all three units', () => {
	const route = Option.getOrThrow(Distance.meters(1750))
	const threshold = Option.getOrThrow(Distance.kilometers(2))

	assert.strictEqual(Distance.Order(route, threshold), -1)
	assert.strictEqual(Distance.toKilometers(route), 1.75)
	assert.strictEqual(Distance.toMeters(threshold), 2000)
	assert.strictEqual(Distance.toMiles(route), 1_750_000 / 1_609_344)
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

it('rounds exact decimal values to the nearest millimeter with ties up', () => {
	for (const [input, expectedMeters] of [
		[0.50049, 0.5],
		[0.5005, 0.501],
		[0.50051, 0.501],
	] as const) {
		assert.strictEqual(Distance.toMeters(Option.getOrThrow(Distance.meters(input))), expectedMeters)
	}

	for (const [input, expectedKilometers] of [
		[4.999999999999999e-7, 0],
		[5e-7, 0.000001],
		[5.000000000000001e-7, 0.000001],
	] as const) {
		assert.strictEqual(
			Distance.toKilometers(Option.getOrThrow(Distance.kilometers(input))),
			expectedKilometers,
		)
	}

	// 0.00390625 miles is exactly 6,286.5 millimeters.
	for (const [input, expectedMeters] of [
		[0.0039062499999999996, 6.286],
		[0.00390625, 6.287],
		[0.003906250000000001, 6.287],
	] as const) {
		assert.strictEqual(Distance.toMeters(Option.getOrThrow(Distance.miles(input))), expectedMeters)
	}
})

it('accepts the representable lengths below the millimeter cap and rejects the next lengths above it', () => {
	const metersBelow = Option.getOrThrow(Distance.meters(9_007_199_254_740.99))
	const kilometersBelow = Option.getOrThrow(Distance.kilometers(9_007_199_254.74099))

	assert.strictEqual(Distance.toKilometers(metersBelow), 9_007_199_254.74099)
	assert.strictEqual(Distance.toMeters(kilometersBelow), 9_007_199_254_740.99)
	assert.isTrue(Option.isNone(Distance.meters(9_007_199_254_740.992)))
	assert.isTrue(Option.isNone(Distance.kilometers(9_007_199_254.740992)))
})

it('checks the mile cap and rounds from the exact decimal length', () => {
	const belowCap = Option.getOrThrow(Distance.miles(5_596_814_139.637635))
	const expected = Option.getOrThrow(Distance.meters(9_007_199_254_740.99))
	assert.isTrue(Distance.equals(belowCap, expected))
	assert.isTrue(Option.isNone(Distance.miles(5_596_814_139.637636)))

	// The exact scaled length ends in 988.452096 mm and rounds down.
	const roundsDown = Option.getOrThrow(Distance.miles(5_596_814_139.637634))
	const roundedMetric = Option.getOrThrow(Distance.kilometers(9_007_199_254.740988))
	assert.isTrue(Distance.equals(roundsDown, roundedMetric))
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

	const halfMile = Option.getOrThrow(Distance.miles(0.5))
	assert.strictEqual(Distance.toMeters(halfMile), 804.672)
	assert.strictEqual(Distance.toMiles(halfMile), 0.5)

	const shorter = Option.getOrThrow(Distance.kilometers(1.5))
	const oneMillimeterLonger = Option.getOrThrow(Distance.meters(1_609.345))
	assert.isFalse(Distance.equals(mile, oneMillimeterLonger))
	assert.deepStrictEqual([oneMillimeterLonger, shorter, mile].sort(Distance.Order), [
		shorter,
		mile,
		oneMillimeterLonger,
	])
})

it('orders distances one millimeter apart near the cap even when displayed miles coincide', () => {
	// The mile input scales to 9,007,199,254,740,986.842752 mm.
	const shorter = Option.getOrThrow(Distance.miles(5_596_814_139.637633))
	const oneMillimeterLonger = Option.getOrThrow(Distance.kilometers(9_007_199_254.740988))

	assert.strictEqual(Distance.toMiles(shorter), Distance.toMiles(oneMillimeterLonger))
	assert.isFalse(Distance.equals(shorter, oneMillimeterLonger))
	assert.strictEqual(Distance.Order(shorter, oneMillimeterLonger), -1)
	assert.strictEqual(Distance.Order(oneMillimeterLonger, shorter), 1)
})

it('compares mixed units by millimeters even when display values coincide', () => {
	const shorter = Option.getOrThrow(Distance.meters(9_007_199_254_740.96))
	const equivalent = Option.getOrThrow(Distance.kilometers(9_007_199_254.74096))
	const oneMillimeterLonger = Option.getOrThrow(Distance.kilometers(9_007_199_254.740961))

	assert.isTrue(Distance.equals(shorter, equivalent))
	assert.strictEqual(Distance.Order(shorter, equivalent), 0)

	assert.strictEqual(Distance.toMeters(shorter), Distance.toMeters(oneMillimeterLonger))
	assert.isFalse(Distance.equals(shorter, oneMillimeterLonger))
	assert.strictEqual(Distance.Order(shorter, oneMillimeterLonger), -1)
	assert.strictEqual(Distance.Order(oneMillimeterLonger, shorter), 1)
})
