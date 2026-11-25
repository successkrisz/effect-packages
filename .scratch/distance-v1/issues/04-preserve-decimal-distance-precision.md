# 04: Preserve decimal distance precision

**What to build:** A caller can construct, compare, sort, and numerically display distances while retaining fractional values beyond millimeter resolution and accepting finite nonnegative inputs beyond the former cap. Store immutable Distance values as private BigDecimal meters and preserve the existing public interface. Follow the [Distance v1 spec](../../../docs/distance-v1-spec.md). This ticket supersedes the historical precision rules in tickets 01 and 02.

**Blocked by:** None (can start immediately against the existing metric and miles implementation). Ticket 03 changes package identity independently; use the package identity present when this ticket is implemented.

**Status:** ready-for-agent

- [ ] `meters`, `kilometers`, and `miles` continue to take a `number` and return `Option<Distance>`. Zero is valid; negative values, `NaN`, and either infinity return `None`.
- [ ] Interpret `number.toString()` as a decimal, including scientific notation, and convert to private BigDecimal meters using exact factors of 1, 1,000, and 1,609.344. Construction preserves that decimal value without quantization or rounding.
- [ ] Remove the safe-integer millimeter cap. Every finite nonnegative numeric input is accepted, including `Number.MIN_VALUE` and `Number.MAX_VALUE` in each supported unit. Canonical-meter values may exceed the JavaScript number range while remaining finite decimals.
- [ ] `equals` and Effect `Order<Distance>` compare internal decimal values numerically across scales and units. Ordering returns zero exactly when equality is true. Submillimeter differences and differences hidden by numeric display conversions remain observable through comparisons.
- [ ] `toMeters`, `toKilometers`, and `toMiles` retain their `number` return types. Perform decimal unit conversion before narrowing to number. Document possible numeric rounding, underflow, and overflow, including decimal division rounding for mile output. Conversion leaves the stored distance unchanged.
- [ ] Public-interface tests replace the historical rounding/rejection expectations with precision preservation, acceptance above the former cap, and tiny/large-value behavior. Include 0.5005 meters, 5 × 10⁻⁷ kilometers equaling 0.0005 meters, one mile equaling 1,609.344 meters and 1.609344 kilometers, and distinct values whose numeric meter conversions coincide.
- [ ] Tests cover conversions of maximum inputs back to their source unit without premature overflow, positive tiny distances remaining distinct from zero despite display underflow, and valid large distances remaining comparable after display overflow. Tests observe public behavior without inspecting private storage.
- [ ] Public documentation states the revised precision and conversion contracts. The repository's required typecheck, format, and test commands pass, followed by the required Effect reviewer feedback.
- [ ] Keep the existing public interface scope: arithmetic, reducers, quantization operations, new input/output forms, schemas, other measurement types, and geographic calculations remain outside this ticket.
