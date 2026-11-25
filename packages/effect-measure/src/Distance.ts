/**
 * Nonnegative lengths measured to the nearest millimeter.
 *
 * @since 0.1.0
 */
import { BigDecimal, Option, Order as order } from 'effect'

const Millimeters = Symbol('effect-measure/Distance/millimeters')
const millimetersPerMeter = 1_000
const millimetersPerKilometer = 1_000_000
const millimetersPerMile = 1_609_344
const maxMillimeters = BigDecimal.fromBigInt(BigInt(Number.MAX_SAFE_INTEGER))

/**
 * An immutable distance with millimeter precision.
 *
 * @category models
 * @since 0.1.0
 */
export interface Distance {
	readonly [Millimeters]: number
}

const makeDistance = (value: number, millimetersPerUnit: number): Option.Option<Distance> => {
	// fromNumber reads the number's decimal representation, including scientific notation.
	const decimal = BigDecimal.fromNumber(value)
	if (Option.isNone(decimal) || value < 0) {
		return Option.none()
	}

	const scaled = BigDecimal.multiply(decimal.value, BigDecimal.fromNumberUnsafe(millimetersPerUnit))
	if (BigDecimal.isGreaterThan(scaled, maxMillimeters)) {
		return Option.none()
	}

	const rounded = BigDecimal.round(scaled, { mode: 'half-ceil' })
	// The rounded count is a safe integer, so converting to number is exact.
	return Option.some(Object.freeze({ [Millimeters]: BigDecimal.toNumberUnsafe(rounded) }))
}

/**
 * Constructs a distance from a length in meters. Rounds to the nearest millimeter,
 * with halfway values rounding up.
 * Returns `None` for negative or non-finite input, or if the exact length exceeds
 * `Number.MAX_SAFE_INTEGER` millimeters.
 *
 * @category constructors
 * @since 0.1.0
 */
export const meters = (value: number): Option.Option<Distance> =>
	makeDistance(value, millimetersPerMeter)

/**
 * Constructs a distance from a length in kilometers. Rounds to the nearest millimeter,
 * with halfway values rounding up.
 * Returns `None` for negative or non-finite input, or if the exact length exceeds
 * `Number.MAX_SAFE_INTEGER` millimeters.
 *
 * @category constructors
 * @since 0.1.0
 */
export const kilometers = (value: number): Option.Option<Distance> =>
	makeDistance(value, millimetersPerKilometer)

/**
 * Constructs a distance from a length in miles. Rounds to the nearest millimeter,
 * with halfway values rounding up.
 * Returns `None` for negative or non-finite input, or if the exact length exceeds
 * `Number.MAX_SAFE_INTEGER` millimeters.
 *
 * @category constructors
 * @since 0.1.0
 */
export const miles = (value: number): Option.Option<Distance> =>
	makeDistance(value, millimetersPerMile)

/**
 * Converts a distance to a number in meters.
 *
 * @category conversions
 * @since 0.1.0
 */
export const toMeters = (self: Distance): number => self[Millimeters] / millimetersPerMeter

/**
 * Converts a distance to a number in kilometers.
 *
 * @category conversions
 * @since 0.1.0
 */
export const toKilometers = (self: Distance): number => self[Millimeters] / millimetersPerKilometer

/**
 * Converts a distance to a number in miles.
 *
 * @category conversions
 * @since 0.1.0
 */
export const toMiles = (self: Distance): number => self[Millimeters] / millimetersPerMile

/**
 * Returns whether two distances have the same millimeter count.
 *
 * @category equivalence
 * @since 0.1.0
 */
export const equals = (self: Distance, that: Distance): boolean =>
	self[Millimeters] === that[Millimeters]

/**
 * Orders distances by ascending millimeter count.
 *
 * @category ordering
 * @since 0.1.0
 */
export const Order: order.Order<Distance> = order.mapInput(
	order.Number,
	(self: Distance) => self[Millimeters],
)
