# 03: Publish Distance through effect-measure

**What to build:** A consumer can use the existing `Distance` interface from the `effect-measure` package through its root namespace and dedicated Distance module export. Rename the existing package consistently across the workspace and its distributable artifacts. Follow the [Distance v1 spec](../../../docs/distance-v1-spec.md); this ticket delivers its package identity change. The numeric representation migration is ticket 04.

**Blocked by:** None (can start immediately against the existing Distance implementation). The rename and ticket 04 can land independently; implementation should use the package identity present at that point.

**Status:** completed

- [x] The workspace package and its directory use `effect-measure`. Package metadata, repository directory metadata, lockfile workspace references, active consumer references, and package-qualified internal identifiers consistently use the new identity.
- [x] Consumers can access the `Distance` namespace from the package root and the existing exports from `effect-measure/Distance`. Published export targets resolve to the renamed package's build artifacts.
- [x] Existing constructor, conversion, equality, and ordering names and TypeScript signatures remain available. This ticket preserves the numeric behavior present when it starts; ticket 04 owns the change in precision semantics.
- [x] Active package descriptions and usage documentation describe the measurement package without introducing other measurement modules. Historical superseded planning documents may retain the original package name.
- [x] Existing package import, build, packing, and portability checks cover the new identity. The typecheck, format, and test commands required by the repository pass, followed by the required Effect reviewer feedback.
  - Formatting, typecheck, all 503 tests, build, packed portability, and packed compatibility passed. An independent Effect review substituted for the unavailable `/effect-smol-qu-reviewer` command and found no actionable issues.
- [x] The rename introduces neither a compatibility package/alias under the former identity nor additional Distance operations.
