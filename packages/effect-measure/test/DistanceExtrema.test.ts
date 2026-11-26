import { assert, it } from '@effect/vitest'
import { Option } from 'effect'
import { Distance } from 'effect-measure'
import { CombinerMin } from 'effect-measure/Distance'

it('folds the longest mixed-unit distance and distinguishes an optional empty fold from zero', () => {
	const mile = Option.getOrThrow(Distance.miles(1))
	const kilometers = Option.getOrThrow(Distance.kilometers(1.234))
	const meters = Option.getOrThrow(Distance.meters(2_000))
	const { initialValue, combine, combineAll } = Distance.ReducerMax

	assert.isTrue(Distance.equals(initialValue, Distance.zero))
	assert.isTrue(Distance.equals(combineAll([]), Distance.zero))
	assert.isTrue(Distance.equals(combineAll([mile]), mile))
	assert.isTrue(Distance.equals(combine(mile, initialValue), mile))
	assert.isTrue(Distance.equals(combineAll([mile, kilometers, meters]), meters))
	assert.isTrue(Distance.equals(combine(combine(mile, kilometers), meters), meters))
	assert.isTrue(Distance.equals(combine(mile, combine(kilometers, meters)), meters))

	const optionalMax = Option.makeReducer(Distance.ReducerMax)
	assert.isTrue(Option.isNone(optionalMax.combineAll([])))
	assert.isTrue(
		Distance.isZero(Option.getOrThrow(optionalMax.combineAll([Option.some(Distance.zero)]))),
	)
})

it('finds the shortest mixed-unit distance and preserves absence when no routes are supplied', () => {
	const mile = Option.getOrThrow(Distance.miles(1))
	const kilometers = Option.getOrThrow(Distance.kilometers(1.234))
	const meters = Option.getOrThrow(Distance.meters(2_000))
	const { combine } = CombinerMin
	const minimum = Option.makeReducer(Distance.CombinerMin)

	assert.isTrue(Option.isNone(minimum.combineAll([])))
	assert.isTrue(
		Distance.isZero(Option.getOrThrow(minimum.combineAll([Option.some(Distance.zero)]))),
	)
	const shortest = minimum.combineAll([
		Option.some(mile),
		Option.some(kilometers),
		Option.some(meters),
	])
	assert.isTrue(Distance.equals(Option.getOrThrow(shortest), kilometers))
	assert.isTrue(Distance.equals(combine(combine(mile, kilometers), meters), kilometers))
	assert.isTrue(Distance.equals(combine(mile, combine(kilometers, meters)), kilometers))
})

it('uses exact decimal equality and ordering when numeric meter displays coincide', () => {
	const mile = Option.getOrThrow(Distance.miles(1))
	const equivalent = Option.getOrThrow(Distance.kilometers(1.609344))
	const shorter = Option.getOrThrow(Distance.meters(100.00000000000001))
	const longer = Option.getOrThrow(Distance.kilometers(0.10000000000000002))

	assert.isTrue(Distance.Equivalence(mile, equivalent))
	assert.isTrue(Distance.equals(mile, equivalent))
	assert.strictEqual(Distance.Order(mile, equivalent), 0)
	assert.strictEqual(Distance.toMeters(shorter), Distance.toMeters(longer))
	assert.isFalse(Distance.Equivalence(shorter, longer))
	assert.isFalse(Distance.equals(shorter, longer))
	assert.strictEqual(Distance.Order(shorter, longer), -1)
	assert.isTrue(Distance.equals(Distance.ReducerMax.combine(longer, shorter), longer))
	assert.isTrue(Distance.equals(Distance.CombinerMin.combine(longer, shorter), shorter))
})
