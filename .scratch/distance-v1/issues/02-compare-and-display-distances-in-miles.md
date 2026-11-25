# 02: Compare and display distances in miles

**Completed scope:** Extend `Distance` with mile-based construction and numeric conversion. The checked acceptance criteria below describe the completed original whole-millimeter implementation. The [revised Distance v1 spec](../../../docs/distance-v1-spec.md) changes that representation and package identity through follow-up tickets [03](03-publish-distance-through-effect-measure.md) and [04](04-preserve-decimal-distance-precision.md); those changes do not reopen this issue.

**Blocked by:** 01 — Compare and display metric distances.

**Status:** completed

## Historical acceptance criteria

- [x] `miles` takes a `number` and returns `Option<Distance>`. It uses the shared construction rules for invalid values, exact decimal scaling, the cap before rounding, and ties-up millimeter rounding, with an exact factor of 1,609,344 millimeters per mile.
- [x] `toMiles` returns a number by dividing the stored millimeter count by 1,609,344, so the caller controls display formatting.
- [x] A distance constructed from one mile compares equal to 1,609.344 meters and 1.609344 kilometers, with `Order` returning zero for both comparisons. Distances one millimeter apart remain distinct and sort correctly, including near the cap.
- [x] Public API tests cover zero, fractional and invalid mile inputs, rounding and cap boundaries, mixed-unit equality and sorting, and numeric mile conversions. Verify the full workflow by constructing a route length in meters, comparing it with a threshold in kilometers, and converting the route length to miles.
