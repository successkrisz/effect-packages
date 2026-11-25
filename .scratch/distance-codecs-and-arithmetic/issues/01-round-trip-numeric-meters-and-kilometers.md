# 01: Round-trip numeric meters and kilometers

**What to build:** A caller can put meter and kilometer codecs directly in a trip payload schema, decode numeric fields into exact distances, and encode distances back into the units required by each field. See the [Distance codecs and arithmetic spec](../spec.md).

**Blocked by:** None (can start immediately).

**Status:** completed

- [x] `Distance.FromMeters` and `Distance.FromKilometers` decode finite, nonnegative numbers and encode numbers in the named unit. Construction preserves the parsed number's decimal value with no meter quantization.
- [x] `Distance.Schema` validates an existing distance via `Distance.isDistance`. The guard accepts values from the public constructors and rejects unrelated values. Use this domain schema as the decoded type of both codecs.
- [x] A struct with `1234` meters and `1.234` kilometers round-trips through the JSON schema. Its fields decode to equal distances, and either distance can encode through either codec as the corresponding number.
- [x] Public tests cover fractional meters, zero, representative same-unit number extremes, and rejection of negative numbers, non-finite numbers, and numeric strings.
- [x] Cross-unit overflow fails with a Schema issue. Finite rounded output, including underflow to zero, follows the existing unit conversion behavior.
- [x] The named exports are available through both existing package imports. Existing numeric constructors and conversions continue to work with their current signatures.
