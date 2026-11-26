# 05: Round-trip exact decimal meters and kilometers

**What to build:** A high-precision consumer can send exact decimal meters or kilometers as strings, compose those fields with numeric distance fields, and preserve exact distances through a JSON codec derived from `Distance.Schema`. See the [Distance codecs and arithmetic spec](../spec.md).

**Blocked by:** [01: Round-trip numeric meters and kilometers](01-round-trip-numeric-meters-and-kilometers.md).

**Status:** completed

- [x] `Distance.FromMetersString` and `Distance.FromKilometersString` decode and encode exact decimal lengths. A successful round trip preserves distance equality and permits canonical spelling.
- [x] The decimal string contract accepts unsigned base-10 text with an optional fraction and exponent. Reject empty, malformed, and negative input and unsupported scales through Schema issues. The supported bounds cover existing numeric constructor values and permit the codecs to decode their canonical output.
- [x] `Schema.toCodecJson(Distance.Schema)` uses the canonical meter string. Inside a struct, an explicit numeric codec continues to emit a plain number, and exact fields emit strings.
- [x] Public tests cover submillimeter values, `9007199254740993`, equivalence across units, canonical spelling, and valid distances with numeric meter overflow.
- [x] Document the accepted decimal text and encoding in the public codec descriptions. The codecs are available through both existing package imports.
