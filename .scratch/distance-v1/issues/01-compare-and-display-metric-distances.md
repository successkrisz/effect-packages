# 01: Compare and display metric distances

**Completed scope:** Introduce `Distance` as a workspace package for metric construction, comparison, and numeric display conversions. The checked acceptance criteria below describe the completed original whole-millimeter implementation. The [revised Distance v1 spec](../../../docs/distance-v1-spec.md) changes that representation and package identity through follow-up tickets [03](03-publish-distance-through-effect-measure.md) and [04](04-preserve-decimal-distance-precision.md); those changes do not reopen this issue.

**Blocked by:** None (can start immediately).

**Status:** completed

## Historical acceptance criteria

- [x] The package exposes a distinct, immutable `Distance` value represented by a whole millimeter count. `meters` and `kilometers` take a `number` and return `Option<Distance>`.
- [x] Both constructors accept zero and return `None` for negative numbers, `NaN`, and either infinity. Interpret `number.toString()` as an exact decimal, including scientific notation, and scale it by 1,000 for meters or 1,000,000 for kilometers.
- [x] Reject an exact scaled value above `Number.MAX_SAFE_INTEGER` millimeters before rounding. Round accepted values once to the nearest millimeter, with exact halfway values rounding up.
- [x] `equals` compares millimeter counts across units. Effect `Order<Distance>` sorts by ascending millimeter count and returns zero exactly when `equals` returns `true`.
- [x] `toMeters` and `toKilometers` return numbers in the requested unit by dividing the millimeter count by that unit's factor.
- [x] Public API tests cover the route and threshold workflow, both conversions, cross-unit equality and ordering, values one millimeter apart, invalid inputs including a negative fraction of a millimeter, rounding below, at, and above a tie, scientific notation, and representable inputs on either side of the cap. Include 0.5005 meters rounding to 501 millimeters and 5 × 10⁻⁷ kilometers rounding to one millimeter.
