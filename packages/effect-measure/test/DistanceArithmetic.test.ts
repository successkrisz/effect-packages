import { assert, it } from '@effect/vitest'
import { Option } from 'effect'
import { Distance } from 'effect-measure'
import { subtract, sum } from 'effect-measure/Distance'

it('recognizes zero distances without rounding away the smallest positive inputs', () => {
	assert.isTrue(Distance.isZero(Distance.zero))
	for (const construct of [Distance.meters, Distance.kilometers, Distance.miles]) {
		const zero = Option.getOrThrow(construct(0))
		assert.isTrue(Distance.equals(Distance.zero, zero))
		assert.isTrue(Distance.isZero(zero))
		assert.isFalse(Distance.isZero(Option.getOrThrow(construct(Number.MIN_VALUE))))
	}
})

it('adds a small mixed-unit route leg exactly even when the total rounds to the larger leg', () => {
	const mainRoute = Option.getOrThrow(Distance.meters(1e16))
	const detour = Option.getOrThrow(Distance.kilometers(5e-7))
	const total = Distance.sum(mainRoute, detour)

	assert.strictEqual(Distance.Order(total, mainRoute), 1)
	assert.strictEqual(Distance.toMeters(total), Distance.toMeters(mainRoute))
	assert.isTrue(Distance.equals(sum(detour)(mainRoute), total))
})

it('subtracts traveled distance exactly and distinguishes completion from overshoot', () => {
	const traveled = Option.getOrThrow(Distance.meters(1e16))
	const detour = Option.getOrThrow(Distance.kilometers(5e-7))
	const planned = Distance.sum(traveled, detour)
	const equivalentTraveled = Option.getOrThrow(Distance.kilometers(1e13))

	assert.isTrue(Distance.equals(Option.getOrThrow(Distance.subtract(planned, traveled)), detour))
	assert.isTrue(Distance.equals(Option.getOrThrow(subtract(traveled)(planned)), detour))
	assert.strictEqual(
		Option.getOrThrow(Distance.subtract(traveled, equivalentTraveled)),
		Distance.zero,
	)
	assert.isTrue(Option.isNone(subtract(planned)(traveled)))
})

it('folds mixed-unit route legs from zero and preserves totals across groupings', () => {
	const mile = Option.getOrThrow(Distance.miles(1))
	const kilometers = Option.getOrThrow(Distance.kilometers(1.234))
	const meters = Option.getOrThrow(Distance.meters(0.0005))
	const total = Option.getOrThrow(Distance.meters(2_843.3445))
	const { initialValue, combine, combineAll } = Distance.ReducerSum

	assert.isTrue(Distance.equals(initialValue, Distance.zero))
	assert.isTrue(Distance.equals(combineAll([]), Distance.zero))
	assert.isTrue(Distance.equals(combineAll([mile]), mile))
	assert.isTrue(Distance.equals(combine(mile, initialValue), mile))
	assert.isTrue(Distance.equals(combineAll(new Set([mile, kilometers, meters])), total))
	assert.isTrue(Distance.equals(combine(combine(mile, kilometers), meters), total))
	assert.isTrue(Distance.equals(combine(mile, combine(kilometers, meters)), total))
})
