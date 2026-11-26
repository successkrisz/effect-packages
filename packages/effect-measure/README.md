# effect-measure

`effect-measure` models nonnegative distances for Effect v4. Decode the units used by an API, file, or configuration into `Distance` values, then compare and combine those values across units. Encode the result in the unit your caller expects.

## Decode meters or kilometers at the boundary

When an input field has a fixed unit, put `Distance.FromMeters` or `Distance.FromKilometers` directly in your `Schema.Struct`. If callers can choose the unit, give the payload an explicit unit field and use a union. Both branches below decode `value` to the same `Distance.Distance` type. The response always uses kilometers.

```ts
import { Effect, Schema } from 'effect'
import { Distance } from 'effect-measure'

const DistanceInput = Schema.Union([
	Schema.Struct({ unit: Schema.Literal('m'), value: Distance.FromMeters }),
	Schema.Struct({ unit: Schema.Literal('km'), value: Distance.FromKilometers }),
])

const normalize = Effect.fn('normalize')(function* (input: unknown) {
	const { value } = yield* Schema.decodeUnknownEffect(DistanceInput)(input)
	const kilometers = yield* Schema.encodeEffect(Distance.FromKilometers)(value)
	return { kilometers }
})

const result = await Effect.runPromise(
	Effect.all([normalize({ unit: 'm', value: 1_750 }), normalize({ unit: 'km', value: 1.75 })]),
)

console.log(result) // [{ kilometers: 1.75 }, { kilometers: 1.75 }]
```

`Schema.decodeUnknownEffect` keeps invalid input in the Effect error channel as a `SchemaError`. The numeric codecs accept finite, nonnegative numbers. An unsupported unit, a negative number, or a numeric string fails validation in this example. Use `Distance.FromMiles` for a numeric field in miles.

## Sort legs, summarize a route, and clamp a fare distance

Once you have decoded the legs, use `Distance.Order` with Effect's array and ordering functions. This example sorts legs from shortest to longest, summarizes the full route, checks whether it exceeds the upper limit, and clamps the distance used to calculate the fare to 1–4 km. The distance calculations stay in the domain type until the result is prepared for display.

```ts
import { Array, Effect, Option, Order, Schema } from 'effect'
import { Distance } from 'effect-measure'

const LegDistances = Schema.Tuple([
	Distance.FromMeters,
	Distance.FromKilometers,
	Distance.FromMeters,
])
const FareBounds = Schema.Struct({
	minimum: Distance.FromKilometers,
	maximum: Distance.FromKilometers,
})

const program = Effect.gen(function* () {
	const legs = yield* Schema.decodeEffect(LegDistances)([750, 2.5, 1_250])
	const bounds = yield* Schema.decodeEffect(FareBounds)({ minimum: 1, maximum: 4 })

	const sorted = Array.sort(legs, Distance.Order)
	const total = Distance.ReducerSum.combineAll(legs)
	const longest = Distance.ReducerMax.combineAll(legs)
	const shortest = Option.makeReducer(Distance.CombinerMin).combineAll(legs.map(Option.some))
	const isWithinLimit = Order.isLessThanOrEqualTo(Distance.Order)(total, bounds.maximum)
	const billable = Order.clamp(Distance.Order)(total, bounds)

	return {
		legsKm: sorted.map(Distance.toKilometers),
		totalKm: Distance.toKilometers(total),
		longestKm: Distance.toKilometers(longest),
		shortestKm: Option.getOrNull(Option.map(shortest, Distance.toKilometers)),
		isWithinLimit,
		billableKm: Distance.toKilometers(billable),
	}
})

const result = await Effect.runPromise(program)
console.log(result)
// { legsKm: [0.75, 1.25, 2.5], totalKm: 4.5, longestKm: 2.5,
//   shortestKm: 0.75, isWithinLimit: false, billableKm: 4 }
```

- Use `Order.min(Distance.Order)` or `Order.max(Distance.Order)` to choose between two distances. Use `Distance.equals` or `Distance.Equivalence` for exact equality across units.
- `Distance.ReducerSum` and `Distance.ReducerMax` return `Distance.zero` for an empty collection. The minimum fold uses `Option.makeReducer(Distance.CombinerMin)` and returns `None` for an empty collection, which the example reports as `null`.
- `Order.clamp` uses inclusive bounds. Supply a minimum less than or equal to the maximum.
- Use `Distance.sum` to add two distances. `Distance.subtract` returns `None` when the amount subtracted exceeds the original distance, and `Some(Distance.zero)` when the values are equal.

## Preserve decimal precision at the boundary

If the wire format can carry decimal strings, use `Distance.FromMetersString` or `Distance.FromKilometersString` to preserve digits beyond JavaScript's number precision. This example accepts an exact kilometer string and returns a canonical meter string.

```ts
import { Effect, Schema } from 'effect'
import { Distance } from 'effect-measure'

const program = Effect.gen(function* () {
	const distance = yield* Schema.decodeUnknownEffect(Distance.FromKilometersString)(
		'9007199254740.993',
	)
	return yield* Schema.encodeEffect(Distance.FromMetersString)(distance)
})

const meters = await Effect.runPromise(program)
console.log(meters) // '9007199254740993'
```

Use `Distance.Schema` to validate an existing `Distance` instance inside a domain schema. Its derived JSON codec, obtained with `Schema.toCodecJson`, represents distances as canonical decimal meter strings. `Distance.FromMilesString` also accepts exact decimal miles. Encoding through that codec succeeds when the distance has a terminating decimal representation in miles.

## Construct from numbers in application code

`Distance.meters`, `Distance.kilometers`, and `Distance.miles` return `Option<Distance>`. They accept finite nonnegative numbers, including zero, and return `None` for negative values, `NaN`, or infinities. You can import the `Distance` module from `effect-measure` or individual exports from `effect-measure/Distance`.

A `Distance` stores its value in decimal meters. For example, one mile, 1,609.344 meters, and 1.609344 kilometers compare equal. Ordering and arithmetic use the stored decimal value, so distinct distances can still sort correctly when their numeric conversions coincide.

`toMeters`, `toKilometers`, and `toMiles` return JavaScript numbers for display or numeric APIs. The result can round, underflow to zero, or overflow to positive infinity. Numeric schema encoders fail on overflow, so use `Schema.encodeEffect` where a wire field requires a finite number.
