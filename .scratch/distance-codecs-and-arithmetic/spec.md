# Distance codecs and arithmetic

**Status:** completed

## Problem Statement

Vehicle and route APIs commonly report distance as a JSON number, such as `1234` meters or `1.234` kilometers. Callers repeat unit conversion and validation when reading these values, and they need to emit numbers again to meet their existing API contracts. Applications that measure smaller lengths also need to retain decimal precision beyond what a JSON number parsed by JavaScript can carry. Once a caller has a `Distance`, computing totals, remaining lengths, and extrema should respect that value's exact ordering and precision.

## Solution

Add named Effect Schema codecs that let callers declare the unit of a JSON number directly in a field. Offer decimal-string codecs for exact interchange and an exact meter-string representation for the general domain schema. Keep finite, nonnegative lengths in exact decimal meters internally. Add exact arithmetic and Effect reducers so applications can work with mixed-unit distances from ingestion through calculation and output.

## User Stories

1. As a vehicle API consumer, I want to read whole meters directly from a JSON number so that I can decode existing route payloads.
2. As a vehicle API consumer, I want to read `1.234` kilometers as exactly 1,234 meters so that I retain the meter precision supplied by the API.
3. As a driver-facing application developer, I want to read and write numeric miles so that I can interoperate with APIs that use miles.
4. As an API developer, I want the schema field to specify its unit so that a payload can keep its existing numeric shape.
5. As an API developer, I want a numeric codec to compose inside a struct so that distance fields are handled with the rest of the payload.
6. As an API developer, I want to encode a distance in the receiving system's unit so that I can pass the same value to APIs using different units.
7. As a caller converting meters to numeric miles, I want repeating quotients to encode as finite approximate numbers so that ordinary conversions succeed.
8. As an integration developer, I want invalid numeric input to fail through Effect Schema so that I can handle bad distance fields alongside other validation errors.
9. As an API developer, I want numeric overflow to fail encoding so that an out-of-range distance cannot appear as a JSON distance field.
10. As an application developer working with small distances, I want fractional meter input to retain its decimal value so that vehicle conventions impose no rounding on my data.
11. As a high-precision API developer, I want to read decimal strings as exact lengths so that JavaScript's number precision does not erase supplied digits.
12. As a high-precision API developer, I want meter and kilometer strings to round-trip exactly so that serializing a length preserves its value.
13. As a data producer who supplies exact miles, I want terminating decimal miles to round-trip so that repeated serialization preserves the measured length.
14. As a data producer who requires exact miles, I want encoding to fail for repeating decimal quotients so that I can select a representation that preserves the distance.
15. As a developer serializing an existing domain object, I want `Distance.Schema` to derive a predictable exact JSON form so that fields preserve their precision without choosing a specific wire codec.
16. As an API developer, I want malformed decimal text to fail validation so that an empty or invalid field cannot silently become zero.
17. As a consumer of exact decimal text, I want equivalent spellings to produce an equal distance so that formatting differences do not affect comparisons.
18. As an application developer accepting unknown values, I want `isDistance` to identify a real `Distance` so that I can narrow the value before passing it to distance operations.
19. As a trip planner, I want to add legs supplied in different units so that the total preserves every leg's decimal contribution.
20. As a trip planner, I want to sum an iterable of legs with an Effect reducer so that an empty trip has a usable total of zero.
21. As a route application developer, I want to subtract traveled distance from planned distance so that I can display the exact remaining length.
22. As a route application developer, I want subtraction below zero to return an explicit absence so that I can handle overshoot separately from completion.
23. As a route application developer, I want a zero constant and predicate so that I can recognize a completed route.
24. As a routing analyst, I want a maximum reducer so that I can find the longest distance in a collection using Effect aggregation APIs.
25. As a routing analyst, I want to find the shortest distance and represent an empty collection as `None` so that it is distinguishable from a zero-length result.
26. As a routing analyst, I want an empty-aware maximum when needed so that no data remains distinguishable from a measured maximum of zero.
27. As a library consumer, I want an Effect equivalence instance so that mixed-unit equality works with APIs that take an `Equivalence`.
28. As an existing library consumer, I want the same constructors, numeric conversions, and ordering to remain available so that I can adopt the new operations incrementally.

## Implementation Decisions

- Extend the public `Distance` module in `effect-measure`. Retain the root namespace and direct subpath imports. Existing values are immutable, finite, and nonnegative. Keep their private `BigDecimal` meter representation and the existing unit factors of 1, 1,000, and 1,609.344 meters.
- Expose `FromMeters`, `FromKilometers`, and `FromMiles` as named schema values. Each accepts a finite, nonnegative number in its named unit using the existing construction contract. Interpret the parsed JavaScript number's decimal representation and scale it exactly into meters. Accept arbitrary fractional input at the precision carried by the number.
- Numeric codecs encode through the existing unit conversions. Decimal conversion precedes narrowing to a number. A finite approximate result is valid, including a repeating miles quotient or underflow to zero. Encoding overflow produces a Schema issue. The numeric representation of ordinary same-unit values, such as meter counts and kilometer values with three decimal places, round-trips without loss.
- Expose `isDistance` and `Distance.Schema` for validating existing domain values. Deriving its JSON codec encodes a decimal meter string. Explicit numeric or string field codecs specify their own wire forms.
- Expose `FromMetersString`, `FromKilometersString`, and `FromMilesString` for exact decimal input. The string contract accepts nonempty unsigned base-10 text with optional fraction and exponent. Reject malformed input and scales outside the supported conversion and arithmetic range through Schema issues. Document the supported bounds when implementing the string codecs and ensure the canonical encoder's output is valid input across the supported domain, including all values from the existing numeric constructors.
- Encode meter and kilometer strings exactly and allow canonical spellings to differ from the original text. Exact mile encoding succeeds when the quotient has a terminating decimal expansion and produces a Schema issue otherwise. Compute terminating quotients without the precision limit of ordinary decimal division. Successful string round trips compare equal by distance.
- Expose `zero`, `isZero`, dual `sum`, and dual `subtract`. Sum in exact decimal meters. Subtract in operand order and return `None` for a negative result or `Some` of the exact result, including `Some(zero)` when the lengths are equal.
- Expose `ReducerSum` and `ReducerMax` using `zero` as the identity for both. Expose `CombinerMin` using the existing `Order`. The finite domain has no identity for a minimum reducer. `Option.makeReducer` lifts the minimum combiner and can lift the maximum reducer when a caller needs an empty-aware result.
- Expose `Equivalence` consistent with `equals` and `Order`. Callers can derive range checks, clamping, and pairwise comparisons from the existing `Order`.

## Testing Decisions

- Test the public `Distance` module and codecs through Effect Schema. Compose codecs inside a struct and exercise raw JSON text with Effect's JSON transformation. Compare values via public equality and ordering, and inspect the encoded payload. Use the existing public Distance tests for mixed-unit equality, Effect `Duration` schemas for codec patterns, and `ByteSize` tests for nonnegative arithmetic.
- Check that `1234` meters and `1.234` kilometers decode to equal distances and encode as the expected JSON numbers, including when the values are cross-encoded. Cover fractional meters, numeric miles with a repeating quotient, same-unit round trips through number extremes, invalid inputs, cross-unit overflow, and cross-unit underflow.
- Check the exact meter-string JSON representation inside a struct, exact meter and kilometer text above number precision and below millimeter resolution, canonical spelling, and mixed string and number fields. Check malformed strings, negative input, and unsafe exponents. For miles, cover one mile, a terminating quotient beyond the ordinary division precision, and the expected failure for one meter.
- Exercise mixed-unit arithmetic with operands that would lose information if added as JavaScript numbers. Verify subtraction at equality and below zero. Verify reducer identities, associativity, empty and singleton inputs, and equivalence across units and scales. Distinguish `None` from `Some(zero)` for empty-aware extrema.
- Verify the named exports through the package's root and direct subpath, using the existing packed compatibility tests where appropriate. Keep tests independent of the private distance representation.

## Out of Scope

- New units, signed or infinite distances, geographic calculations, and other measurement types.
- Scalar multiplication, division, averages, ratios, and public `BigDecimal` constructors or accessors.
- Display formatting, localization, explicit quantization, and guarded exact-only numeric codecs.
- Tagged wire payloads with a runtime-selected unit.

## Further Notes

The numeric payload prototype verified a mixed-unit JSON struct round trip. A separate runtime probe verified that the pinned Effect decimal division can round a terminating miles quotient at high precision. The exact miles codec includes this as a public regression case. See the [Distance proposal](../../docs/distance-next-steps.md) and the [Distance v1 spec](../../docs/distance-v1-spec.md).
