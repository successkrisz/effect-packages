# Distance v1

**Status:** completed

## Problem Statement

Application code receives route lengths and thresholds in different units. When both values are plain numbers, callers have to remember which unit each number represents and convert before comparing them. Repeating that logic at each call site makes it easy to compare incompatible values. Calculated distances can include fractional meters, and rounding every input to whole millimeters discards information before the application chooses how to use it. A safe-integer millimeter cap also rejects otherwise valid finite inputs.

## Solution

Provide an Effect-style `Distance` value for finite, nonnegative physical distances in the `effect-measure` package. Callers construct a distance in meters, kilometers, or miles, then pass the same value through application code. Construction preserves the input's decimal representation in canonical meters without rounding. Comparisons use that internal value. At display time, callers choose the output unit and format the resulting number for their audience.

## User Stories

1. As an API consumer, I want to construct a distance from meters so I can use route lengths from an API without carrying a separate unit flag.
2. As an application developer, I want to construct a threshold in kilometers so I can express it in the unit used by the product.
3. As an application developer, I want to accept distances supplied in miles so I can compare them with values from metric sources.
4. As an application developer, I want invalid numeric inputs to return `None` so I can handle bad data before comparing or displaying a distance.
5. As an application developer, I want zero to be a valid distance so I can represent a route whose start and end coincide.
6. As an application developer, I want fractional distances to retain submillimeter differences so construction preserves information needed by later calculations or comparisons.
7. As an application developer, I want finite nonnegative inputs beyond the former safe-integer millimeter cap to remain valid so the storage representation does not impose that application limit.
8. As an application developer, I want equivalent lengths to compare equal across units so I can tell when a route exactly meets a threshold.
9. As an application developer, I want to sort mixed-unit distances with an Effect `Order` so I can rank routes by length.
10. As a UI developer, I want to convert a distance to a number in the display unit so I can choose the label, decimal places, and locale at the call site.
11. As a library consumer, I want to import `Distance` from `effect-measure` so the package can host related measurement modules in the future.
12. As an application developer, I want equality and ordering to preserve distinctions even when numeric display conversions produce the same number.
13. As an application developer, I want very small positive inputs to remain distinct from zero so a fixed minimum increment does not erase them.
14. As a library consumer, I want the existing numeric constructor and conversion signatures to remain available so the representation change does not require a new input or output model.

## Implementation Decisions

### Package and public interface

Rename the workspace package from `effect-distance` to `effect-measure`, including its workspace directory, package metadata, lockfile references, package-qualified internal identifiers, and active consumer references. The root export continues to expose the `Distance` namespace, and the module remains available through the `effect-measure/Distance` public import. The feature remains named Distance v1.

The public interface remains `Distance`, `meters`, `kilometers`, `miles`, `toMeters`, `toKilometers`, `toMiles`, `equals`, and `Order`. The package rename changes import specifiers; it does not add measurement types or operations.

### Representation and construction

`Distance` is a distinct, immutable value backed internally by an Effect `BigDecimal` representing meters. The representation is private. Construction uses exact decimal scaling without quantizing to a fixed increment. Canonical meters specify the unit; values may have different decimal scales. The implementation must not truncate values to force a common scale.

| Input constructor | Output conversion | Meters per unit |
| --- | --- | ---: |
| `meters` | `toMeters` | 1 |
| `kilometers` | `toKilometers` | 1,000 |
| `miles` | `toMiles` | 1,609.344 |

All three constructors take a `number` and return `Option<Distance>` under the same rules.

1. Return `None` for negative values, `NaN`, and either infinity. Zero is valid.
2. Interpret the result of `number.toString()` as a decimal, including scientific notation. This preserves that decimal representation, not information already lost before the number reached the constructor.
3. Multiply by the unit's exact decimal meters-per-unit factor using `BigDecimal` arithmetic. Store the resulting value in `Some` without rounding.
4. Accept every finite nonnegative numeric input, including values beyond the former cap. The scaled meter value remains a finite decimal even when converting it to a JavaScript number in meters would overflow.

### Equality and ordering

`equals` takes two `Distance` values and compares their internal decimal meter values numerically, independently of their decimal scales. `Order` is an Effect `Order<Distance>` that sorts by ascending distance and returns zero exactly when `equals` returns `true`. Neither operation narrows the values to JavaScript numbers or introduces rounding. For example, one mile, 1,609.344 meters, and 1.609344 kilometers compare equal. Distinct submillimeter distances remain distinct.

### Numeric conversions

Each conversion takes a `Distance` and returns a `number` in the requested unit. Perform the unit conversion in decimal arithmetic before narrowing to a JavaScript number, so an intermediate numeric meter value cannot overflow or underflow before conversion to the requested unit.

Numeric conversions are approximate display/interoperability operations. They may round, underflow to zero, or overflow to positive infinity when the requested unit's value is outside the representable numeric range. Conversion to miles can require decimal division rounding because the quotient may repeat. These conversions do not alter the stored distance, and their results must not be used internally for equality or ordering. The no-rounding guarantee applies to construction, stored values, and comparisons.

## Testing Decisions

Exercise the existing public `Distance` interface as the single behavioral test seam. Construct values and observe the returned `Option`, numeric conversions, equality, and ordering. Tests must not inspect the private representation. Follow the repo's Vitest conventions and the upstream `Duration` tests for mixed-unit comparisons. Validate the package identity through its root and module exports and the repository's existing packaging checks.

- Check zero and fractional inputs for all three units. Check that each constructor rejects negative values, `NaN`, and both infinities. Include a negative fraction of a millimeter to verify rejection at submillimeter magnitudes.
- Check values below, at, and above a former half-millimeter rounding boundary; all three remain distinct and ordered. Include 0.5005 meters converting back to 0.5005 meters and 5 × 10⁻⁷ kilometers converting to 0.0005 meters.
- Check finite inputs immediately below and above the former cap; both are accepted. Include 9,007,199,254,740.99 meters and 9,007,199,254,740.992 meters. Calculate expected comparisons from their decimal representations.
- Check very small positive inputs, including `Number.MIN_VALUE`, remain greater than zero. Check `Number.MAX_VALUE` for each constructor. Constructing the maximum value in kilometers or miles must remain valid and convert back to that input unit without premature intermediate overflow.
- Verify the documented numeric conversion limits: a very small distance may convert to zero in a larger unit, and an accepted large distance may convert to positive infinity in a smaller unit. Its internal comparisons remain valid after conversion.
- Compare one mile, 1,609.344 meters, and 1.609344 kilometers for equality and an order of zero. Verify scale-independent equality and submillimeter ordering. Include distinct values whose numeric meter conversions coincide, such as 100.00000000000001 meters and 0.10000000000000002 kilometers.
- Exercise the route workflow by constructing a route length in meters, comparing it with a threshold in kilometers, and converting the route length to miles. Check representative outputs in each unit.

## Out of Scope

- Additional units and signed distances.
- Arithmetic on distances, reducers, and calculations from geographic coordinates.
- Public string, `bigint`, or `BigDecimal` constructors; exact decimal/string output methods; Schema codecs; and serialization formats.
- Explicit quantization operations, display formatting, labels, and localization.
- Other measurement modules such as Length, Speed, Acceleration, Angle, and Heading, and Geo functionality.
- Compatibility aliases for the former package name.

## Further Notes

This revision supersedes the original whole-millimeter representation, ties-up rounding rule, and safe-integer millimeter cap. Tickets 01 and 02 are completed under their original contract and retain their checked historical acceptance criteria. Tickets 03 and 04 capture the package rename and precision migration as follow-up changes to that implementation.

`BigDecimal` was chosen over fixed-resolution `bigint` storage to preserve supplied decimal precision across distance applications. This accepts additional arithmetic and allocation costs. Exploratory Node 26 measurements of batched trip ingestion and aggregation supported that tradeoff; they are not a performance guarantee or a new benchmark requirement for v1.

Numeric inputs and outputs retain JavaScript number limitations. Converting a distance to a number and constructing another distance from that output may change its value. The preserved decimal digits also do not establish the accuracy of an underlying GPS measurement or geographic calculation.
