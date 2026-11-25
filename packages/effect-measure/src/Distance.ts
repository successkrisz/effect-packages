/**
 * Immutable, nonnegative lengths with exact decimal construction and comparison.
 *
 * @since 0.1.0
 */
import { BigDecimal, Equal, Hash, Option, Order as order } from 'effect'

const metersPerMeter = BigDecimal.fromBigInt(1n)
const metersPerKilometer = BigDecimal.fromBigInt(1_000n)
const metersPerMile = BigDecimal.fromStringUnsafe('1609.344')
const kilometersPerMeter = BigDecimal.fromStringUnsafe('0.001')

class DistanceValue {
	readonly #meters: BigDecimal.BigDecimal

	constructor(meters: BigDecimal.BigDecimal) {
		this.#meters = meters
		Object.freeze(this)
	}

	static toMeters(self: DistanceValue): number {
		return BigDecimal.toNumberUnsafe(self.#meters)
	}

	static toKilometers(self: DistanceValue): number {
		return BigDecimal.toNumberUnsafe(BigDecimal.multiply(self.#meters, kilometersPerMeter))
	}

	static toMiles(self: DistanceValue): number {
		return BigDecimal.toNumberUnsafe(BigDecimal.divideUnsafe(self.#meters, metersPerMile))
	}

	static compare(self: DistanceValue, that: DistanceValue): -1 | 0 | 1 {
		return BigDecimal.Order(self.#meters, that.#meters)
	}

	// Keep Effect's comparison protocols available without exposing them on the public type.
	static {
		Object.defineProperties(DistanceValue.prototype, {
			[Equal.symbol]: {
				value(this: DistanceValue, that: unknown): boolean {
					return (
						typeof that === 'object' &&
						that !== null &&
						#meters in that &&
						DistanceValue.compare(this, that) === 0
					)
				},
			},
			[Hash.symbol]: {
				value(this: DistanceValue): number {
					return Hash.hash(this.#meters)
				},
			},
		})
	}
}

/**
 * An immutable distance stored in decimal meters.
 * @category models
 * @since 0.1.0
 */
export interface Distance extends DistanceValue {}

const makeDistance = (
	value: number,
	metersPerUnit: BigDecimal.BigDecimal,
): Option.Option<Distance> => {
	// fromNumber reads the number's decimal representation, including scientific notation.
	const decimal = BigDecimal.fromNumber(value)
	if (Option.isNone(decimal) || value < 0) {
		return Option.none()
	}

	return Option.some(new DistanceValue(BigDecimal.multiply(decimal.value, metersPerUnit)))
}

/**
 * Constructs a distance from a length in meters, preserving the input's decimal
 * representation. Returns `None` for negative or non-finite input.
 *
 * @category constructors
 * @since 0.1.0
 */
export const meters = (value: number): Option.Option<Distance> =>
	makeDistance(value, metersPerMeter)

/**
 * Constructs a distance from a length in kilometers, preserving the input's
 * decimal representation. Returns `None` for negative or non-finite input.
 *
 * @category constructors
 * @since 0.1.0
 */
export const kilometers = (value: number): Option.Option<Distance> =>
	makeDistance(value, metersPerKilometer)

/**
 * Constructs a distance from a length in miles, preserving the input's decimal
 * representation. Returns `None` for negative or non-finite input.
 *
 * @category constructors
 * @since 0.1.0
 */
export const miles = (value: number): Option.Option<Distance> => makeDistance(value, metersPerMile)

/**
 * Converts a distance to a number in meters. The result can round or overflow
 * to positive infinity. The stored distance is immutable.
 *
 * @category conversions
 * @since 0.1.0
 */
export const toMeters: (self: Distance) => number = DistanceValue.toMeters

/**
 * Converts a distance to a number in kilometers. Decimal scaling occurs before
 * narrowing to a number, which can round, underflow to zero, or overflow to
 * positive infinity. The stored distance is immutable.
 *
 * @category conversions
 * @since 0.1.0
 */
export const toKilometers: (self: Distance) => number = DistanceValue.toKilometers

/**
 * Converts a distance to a number in miles. Decimal division can round a
 * repeating quotient before narrowing to a number, which can round or underflow
 * to zero. The stored distance is immutable.
 *
 * @category conversions
 * @since 0.1.0
 */
export const toMiles: (self: Distance) => number = DistanceValue.toMiles

/**
 * Returns whether two distances have numerically equal decimal meter values.
 * @category equivalence
 * @since 0.1.0
 */
export const equals = (self: Distance, that: Distance): boolean =>
	DistanceValue.compare(self, that) === 0

/**
 * Orders distances by ascending decimal meter value.
 * @category ordering
 * @since 0.1.0
 */
export const Order: order.Order<Distance> = order.make(DistanceValue.compare)
