# 02: Round-trip numeric miles

**What to build:** A caller can declare numeric miles in a JSON payload and use those lengths alongside values from metric APIs. Distances whose miles value repeats still encode to a finite number when within range. See the [Distance codecs and arithmetic spec](../spec.md).

**Blocked by:** [01: Round-trip numeric meters and kilometers](01-round-trip-numeric-meters-and-kilometers.md).

**Status:** completed

- [x] `Distance.FromMiles` decodes a finite, nonnegative number using the existing exact mile construction contract and encodes as a number in miles using the existing conversion.
- [x] A payload containing one mile and 1,609.344 meters decodes to equal distances and encodes back to the original numeric units.
- [x] One meter encodes successfully as a finite positive approximation in miles. Zero and representative same-unit values at both ends of the finite number range round-trip.
- [x] Invalid fields produce Schema issues. Apply the same finite output constraint as the metric codecs. Finite rounding and underflow follow the existing mile conversion.
- [x] Public tests exercise the new codec in a JSON struct. Its export is available through both existing package imports.
