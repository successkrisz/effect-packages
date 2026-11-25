# 04: Find shortest and longest distances

**What to build:** A caller can find the extrema of mixed-unit trip distances and distinguish an empty collection from a collection containing a zero-length trip when that distinction matters. See the [Distance codecs and arithmetic spec](../spec.md).

**Blocked by:** [03: Total routes and calculate remaining distance](03-total-routes-and-calculate-remaining-distance.md).

**Status:** completed

- [x] `Distance.ReducerMax` selects the largest value according to `Distance.Order`. Zero is its identity and its result for an empty iterable.
- [x] `Distance.CombinerMin` selects the smallest value according to `Distance.Order` and composes with Effect's `Option.makeReducer`. An empty optional fold yields `None` and a singleton containing zero yields `Some(zero)`.
- [x] The maximum reducer also composes with `Option.makeReducer` for callers who need an empty-aware maximum.
- [x] `Distance.Equivalence` agrees with `Distance.equals` and the equality case of `Distance.Order`, including across units and decimal scales.
- [x] Public tests cover mixed-unit extrema, grouping, empty and singleton collections, and distinct values whose numeric meter conversions coincide.
