# 03: Total routes and calculate remaining distance

**What to build:** A trip application can add exact mixed-unit route legs, fold a collection of legs into a total, and calculate the remaining distance after travel. See the [Distance codecs and arithmetic spec](../spec.md).

**Blocked by:** None (can start immediately).

**Status:** completed

- [x] `Distance.zero` compares equal to a zero constructed in any supported unit. `Distance.isZero` distinguishes zero from the smallest positive values accepted by the existing constructors.
- [x] Dual `Distance.sum` adds the exact decimal lengths. Public tests show a mixed-unit total retaining an addend that would disappear in JavaScript number arithmetic.
- [x] `Distance.ReducerSum` sums an iterable with zero as its identity. Public tests cover empty and singleton iterables, mixed-unit folds, and equality across groupings.
- [x] Dual `Distance.subtract` returns `Some` of the exact remaining distance when the result is nonnegative, `Some(zero)` for equal lengths, and `None` when the amount subtracted exceeds the original distance.
- [x] Public tests exercise data-first and data-last arithmetic through the package exports and observe results via public equality or ordering.
