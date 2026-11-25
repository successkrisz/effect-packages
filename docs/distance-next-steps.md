# Distance next steps

**Status:** completed

Start with Schema codecs for JSON numbers in meters, kilometers, and miles. A vehicle API can send `1234` meters or `1.234` kilometers, and both decode to the same exact `Distance`. Keep `BigDecimal` internally so arithmetic and comparisons preserve fractional meters in applications that need them. Offer decimal-string codecs for fields that need exact values beyond JavaScript number precision. [Distance v1](distance-v1-spec.md) · [Distance implementation](../packages/effect-measure/src/Distance.ts)

## Schema codecs

### JSON number fields

Follow `DurationFromMillis` with a codec for each supported unit. Each codec reads a `number` and encodes a `Distance` back to a `number` in that field's unit. [Duration schemas](../.repos/effect/packages/effect/src/Schema.ts#L13576)

| Proposed export | Example JSON field value |
| --- | --- |
| `Distance.FromMeters` | `1234` |
| `Distance.FromKilometers` | `1.234` |
| `Distance.FromMiles` | `0.7667720512208701` |

Use the codec directly in a `Schema.Struct` for an already parsed payload, or wrap the struct in `Schema.fromJsonString` to parse and emit JSON text. [Schema.fromJsonString](../.repos/effect/packages/effect/src/Schema.ts#L9808)

```ts
import { Schema } from "effect"
import { Distance } from "effect-measure"

const Trip = Schema.Struct({
  routeKm: Distance.FromKilometers,
  remainingMeters: Distance.FromMeters,
})
const TripJson = Schema.fromJsonString(Trip)

const trip = Schema.decodeUnknownSync(TripJson)(
  '{"routeKm":1.234,"remainingMeters":1234}',
)
Distance.equals(trip.routeKm, trip.remainingMeters) // true
Schema.encodeSync(TripJson)(trip) // '{"routeKm":1.234,"remainingMeters":1234}'
Schema.encodeSync(Distance.FromKilometers)(trip.remainingMeters) // 1.234
```

Decode finite, nonnegative numbers through the matching v1 constructor. That preserves the decimal representation of the parsed JavaScript number and scales it exactly into meters. Meter precision is a property of a particular payload. The same codec accepts `0.000125` meters, and an application can add a whole-meter constraint if its wire contract requires one. [Distance construction](distance-v1-spec.md#representation-and-construction) · [Schema.Finite](../.repos/effect/packages/effect/src/Schema.ts#L7437)

Encode through the matching v1 conversion. Decimal unit conversion happens before narrowing to `number`. Finite rounded results are valid, including mile conversions with repeating decimals and values small enough to underflow to zero. Overflow produces a Schema issue because JSON cannot encode infinity. A same-unit round trip of an ordinary numeric payload preserves the numeric value, while a distance computed in decimal arithmetic may lose precision when encoded as a JSON number. Exact arithmetic and comparison continue to use the stored value. [Distance numeric conversion contract](distance-v1-spec.md#numeric-conversions) · [RFC 8259 §6](https://www.rfc-editor.org/rfc/rfc8259.html#section-6)

### Exact decimal fields

Provide explicit string codecs for high-precision interchange and use a decimal meter string when deriving a JSON codec directly from `Distance.Schema`. This follows `Schema.BigDecimal` and lets a struct mix numeric vehicle fields with exact fields as required. [BigDecimal schema](../.repos/effect/packages/effect/src/Schema.ts#L10834) · [ByteSize schemas](../.repos/effect/packages/effect/src/Schema.ts#L10910)

| Proposed export | Encoded value | Contract |
| --- | --- | --- |
| `Distance.Schema` | `Distance` | Validate an existing value using `Distance.isDistance`. `Schema.toCodecJson(Distance.Schema)` uses the meter-string codec. |
| `Distance.FromMetersString` | `"1609.344"` | Exact decimal meters. |
| `Distance.FromKilometersString` | `"1.609344"` | Exact decimal kilometers. Decoding multiplies by 1,000 and encoding shifts the decimal point back. |
| `Distance.FromMilesString` | `"1"` | Exact decimal miles. Decoding multiplies by 1,609.344. Encoding fails with a Schema issue when the quotient has no terminating decimal expansion. |

Build the domain schema with `Schema.declare` and compose the wire codecs with `Schema.decodeTo`. Share the unit conversion logic. Accept unsigned, nonempty base-10 text with an optional fractional part and exponent, since normalized output can use exponent notation. `BigDecimal.fromString("")` accepts the empty string as zero, and the parser accepts exponents whose scales are near the safe-integer limit. Validate the text syntax and reject scales that the supported conversions and arithmetic cannot handle. Choose those bounds before publishing the codecs and cover all v1 constructor values. Successful round trips compare by `Distance.equals`. Encoding after decoding `"1.000"` may emit the canonical spelling `"1"`. [Schema declaration](../.repos/effect/packages/effect/src/Schema.ts#L578) · [Schema transforms](../.repos/effect/packages/effect/src/Schema.ts#L5651) · [BigDecimal parsing and formatting](../.repos/effect/packages/effect/src/BigDecimal.ts#L1294)

One meter has a repeating decimal expansion in miles. If the meter value is `coefficient × 10^-scale`, the miles quotient terminates exactly when its coefficient is divisible by 12,573. The mile factor is `(2^7 × 12,573) / 10^3`. For a terminating quotient, use integer scaling to produce coefficient `(coefficient / 12,573) × 78,125` and scale `scale + 4`. A runtime probe with `12573n * (10n ** 110n + 1n)` meters confirmed that `BigDecimal.divideUnsafe` can round a terminating result once it reaches its working precision. [Distance unit factors](../packages/effect-measure/src/Distance.ts#L8) · [BigDecimal division](../.repos/effect/packages/effect/src/BigDecimal.ts#L477)

## Reducers and combiners

`Duration` ships `ReducerSum`, `CombinerMax`, and `CombinerMin`. `ByteSize` follows the same convention. An Effect `Reducer` has a neutral `initialValue` and folds an iterable from that value. A `Combiner` supplies only the binary operation. The nonnegative `Distance` domain makes `zero` a valid maximum identity. It has no greatest value to serve as a minimum identity. [Duration instances](../.repos/effect/packages/effect/src/Duration.ts#L1825) · [ByteSize instances](../.repos/effect/packages/effect/src/ByteSize.ts#L751) · [Reducer interface](../.repos/effect/packages/effect/src/Reducer.ts#L15)

| Proposed export | Definition | Empty input |
| --- | --- | --- |
| `ReducerSum` | `Reducer.make(sum, zero)` using `BigDecimal.sum` | `zero` |
| `ReducerMax` | `Reducer.make(max, zero)` using `Order.max(Distance.Order)` | `zero` |
| `CombinerMin` | `Combiner.min(Distance.Order)` | No empty fold on the combiner |

Use `Option.makeReducer(Distance.CombinerMin)` when a minimum needs an empty result. `None` is neutral, so an empty collection yields `None` and the minimum of a nonempty collection is `Some(distance)`. `Option.makeReducer(Distance.ReducerMax)` also works when a caller needs to distinguish an empty collection from a collection whose largest distance is zero. [Option.makeReducer](../.repos/effect/packages/effect/src/Option.ts#L2438)

## Primitives to add with these changes

- `zero`, `isZero`, and `isDistance` support folds, zero checks, and the domain schema. The runtime guard can check the private field brand after confirming the input is an object. [Distance value](../packages/effect-measure/src/Distance.ts#L13) · [Duration guards](../.repos/effect/packages/effect/src/Duration.ts#L434)
- Dual `sum` covers route totals with exact decimal addition. The existing `Order` already gives callers `Order.min`, `Order.max`, `Order.isBetween`, and `Order.clamp`. `Equivalence` can reuse `equals` for APIs that consume an equivalence instance. [BigDecimal.sum](../.repos/effect/packages/effect/src/BigDecimal.ts#L298) · [Order helpers](../.repos/effect/packages/effect/src/Order.ts#L824) · [Duration.Equivalence](../.repos/effect/packages/effect/src/Duration.ts#L1261)
- `subtract(self, that): Option<Distance>` is the next arithmetic primitive for remaining distance. Return `None` when the result would be negative and `Some(zero)` when the operands are equal, following the nonnegative `ByteSize` domain. [ByteSize arithmetic](../.repos/effect/packages/effect/src/ByteSize.ts#L637)

Consider `times` with a finite, nonnegative scalar for repeated segments or scaling. Division, averages, and ratios need precision and rounding contracts before they become public arithmetic. Public `fromBigDecimalMeters` and `toBigDecimalMeters` can help callers feed exact calculations into and out of the domain. Copy or snapshot the decimal at that seam because the Effect `BigDecimal` object is mutable at runtime. Add units such as feet or nautical miles, and formatting, when concrete workflows establish which units and presentation rules they need. [BigDecimal representation](../.repos/effect/packages/effect/src/BigDecimal.ts#L112) · [ByteSize formatting](../.repos/effect/packages/effect/src/ByteSize.ts#L735)

## Verification for implementation

- Round-trip a JSON struct with `1234` meters and `1.234` kilometers and verify the fields decode to equal distances. Cross-encode those distances in both units. Check fractional meters, same-unit round trips at both ends of the finite number range, and encoding a meter value whose miles quotient repeats.
- Test negative input, `NaN`, both infinities, and numeric strings. Check that cross-unit overflow fails with a Schema issue and that cross-unit underflow follows the existing numeric conversion behavior.
- Round-trip meter and kilometer strings representing submillimeter values, `9007199254740993`, the smallest and largest supported v1 inputs, and values whose numeric meter conversion overflows. Check canonical spelling and run an exact round trip for `Distance.Schema` inside a JSON struct.
- Decode equal lengths across all three unit codecs. Encode an exact mile value, a terminating quotient above the default decimal division precision, and one meter, which must fail encoding to exact miles. Include blank, negative, malformed, and excessive exponent input.
- Check reducer identities, associativity under `Distance.equals`, empty and singleton inputs, and mixed-unit folds. Exercise totals where the smaller addend would disappear in JavaScript number arithmetic. Compare `None` for an empty minimum with `Some(zero)` for the minimum of a collection containing zero.
