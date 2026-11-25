# 06: Round-trip exact decimal miles

**What to build:** A caller working with exact miles can round-trip any supported distance with a terminating decimal mile value and can detect when a length needs another exact representation. See the [Distance codecs and arithmetic spec](../spec.md).

**Blocked by:** [05: Round-trip exact decimal meters and kilometers](05-round-trip-exact-decimal-meters-and-kilometers.md).

**Status:** completed

- [x] `Distance.FromMilesString` decodes supported decimal text with the same validation rules as the exact metric codecs and converts miles to canonical meters exactly.
- [x] Exact mile encoding succeeds for terminating decimal quotients and fails with a Schema issue when division would repeat. One mile round-trips as `"1"`, and one meter fails to encode as exact miles.
- [x] A terminating quotient that exceeds the pinned Effect division precision still encodes and decodes to an equal `Distance`. Exercise the case through the public meter and mile string codecs.
- [x] Public tests cover zero, fractional miles, and equivalence to metric lengths. The codec composes in a struct and is available through both existing package imports.
