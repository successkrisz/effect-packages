/**
 * Immutable, nonnegative lengths with exact decimal construction and comparison.
 *
 * @since 0.1.0
 */
import {
	BigDecimal,
	Combiner,
	Equal,
	type Equivalence as equivalence,
	Hash,
	Option,
	Order as order,
	Predicate,
	Reducer,
	SchemaTransformation,
	Schema as schema,
} from 'effect'
import { dual } from 'effect/Function'

const metersPerMeter = BigDecimal.fromBigInt(1n)
const metersPerKilometer = BigDecimal.fromBigInt(1_000n)
const metersPerMile = BigDecimal.fromStringUnsafe('1609.344')
const kilometersPerMeter = BigDecimal.divideUnsafe(metersPerMeter, metersPerKilometer)

class DistanceValue {
	readonly #meters: BigDecimal.BigDecimal

	constructor(meters: BigDecimal.BigDecimal) {
		this.#meters = meters
		Object.freeze(this)
	}

	static isZero(self: DistanceValue): boolean {
		return BigDecimal.isZero(self.#meters)
	}

	static sum(self: DistanceValue, that: DistanceValue): DistanceValue {
		return new DistanceValue(BigDecimal.sum(self.#meters, that.#meters))
	}

	static subtract(self: DistanceValue, that: DistanceValue): Option.Option<DistanceValue> {
		const remaining = BigDecimal.subtract(self.#meters, that.#meters)
		if (BigDecimal.isNegative(remaining)) {
			return Option.none()
		}
		return Option.some(BigDecimal.isZero(remaining) ? zero : new DistanceValue(remaining))
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

	static isDistance(value: unknown): value is DistanceValue {
		return Predicate.isObjectOrArray(value) && #meters in value
	}

	// Keep Effect's comparison protocols available without exposing them on the public type.
	static {
		Object.defineProperties(DistanceValue.prototype, {
			[Equal.symbol]: {
				value(this: DistanceValue, that: unknown): boolean {
					return DistanceValue.isDistance(that) && DistanceValue.compare(this, that) === 0
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
 * The distance of zero meters.
 * @category constructors
 * @since 0.1.0
 */
export const zero: Distance = new DistanceValue(BigDecimal.fromBigInt(0n))

/**
 * Returns whether a distance is exactly zero.
 * @category predicates
 * @since 0.1.0
 */
export const isZero: (self: Distance) => boolean = DistanceValue.isZero

/**
 * Adds two distances exactly in decimal meters.
 * @category math
 * @since 0.1.0
 */
export const sum: {
	(that: Distance): (self: Distance) => Distance
	(self: Distance, that: Distance): Distance
} = dual(2, DistanceValue.sum)

/**
 * Subtracts `that` from `self` exactly. Returns `None` when `that` exceeds
 * `self` and `Some(zero)` when the distances are equal.
 * @category math
 * @since 0.1.0
 */
export const subtract: {
	(that: Distance): (self: Distance) => Option.Option<Distance>
	(self: Distance, that: Distance): Option.Option<Distance>
} = dual(2, DistanceValue.subtract)

/**
 * Folds an iterable of distances using exact addition, starting from zero.
 * @category math
 * @since 0.1.0
 */
export const ReducerSum: Reducer.Reducer<Distance> = Reducer.make(sum, zero)

/**
 * Compares distances for exact decimal equality across units.
 * @category equivalence
 * @since 0.1.0
 */
export const Equivalence: equivalence.Equivalence<Distance> = equals

/**
 * Orders distances by ascending decimal meter value.
 * @category ordering
 * @since 0.1.0
 */
export const Order: order.Order<Distance> = order.make(DistanceValue.compare)

/**
 * Folds an iterable to its largest distance, starting from zero.
 * @category math
 * @since 0.1.0
 */
export const ReducerMax: Reducer.Reducer<Distance> = Reducer.make(order.max(Order), zero)

/**
 * Keeps the smaller of two distances. Use `Option.makeReducer` to fold with
 * `None` as the empty result.
 * @category math
 * @since 0.1.0
 */
export const CombinerMin: Combiner.Combiner<Distance> = Combiner.min(Order)

/**
 * Returns whether an unknown value is a distance constructed by this module.
 * @category guards
 * @since 0.1.0
 */
export const isDistance: (value: unknown) => value is Distance = DistanceValue.isDistance

/**
 * Schema for an existing distance value.
 * @category schemas
 * @since 0.1.0
 */
export const Schema: schema.declare<Distance> = schema.declare(isDistance, { expected: 'Distance' })

const nonNegativeFinite = schema.Finite.check(schema.isGreaterThanOrEqualTo(0))

const fromNumber = (
	construct: (value: number) => Option.Option<Distance>,
	convert: (self: Distance) => number,
): schema.decodeTo<typeof Schema, schema.Finite> =>
	nonNegativeFinite.pipe(
		schema.decodeTo(
			Schema,
			SchemaTransformation.transform({
				// Every value accepted by the numeric schema is a valid constructor input.
				decode: (value) => Option.getOrThrow(construct(value)),
				encode: convert,
			}),
		),
	)

/**
 * Codec for finite, nonnegative numbers in meters. Encoding may round and
 * fails if conversion produces infinity.
 * @category schemas
 * @since 0.1.0
 */
export const FromMeters: schema.decodeTo<typeof Schema, schema.Finite> = fromNumber(
	meters,
	toMeters,
)

/**
 * Codec for finite, nonnegative numbers in kilometers. Encoding may round or
 * underflow to zero and fails if conversion produces infinity.
 * @category schemas
 * @since 0.1.0
 */
export const FromKilometers: schema.decodeTo<typeof Schema, schema.Finite> = fromNumber(
	kilometers,
	toKilometers,
)
