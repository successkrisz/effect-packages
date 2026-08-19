# Setup Effect TSGo (TypeScript 7 + Effect RC + pnpm 11)

Configure this repository to use stable **TypeScript 7** patched with **`@effect/tsgo`** as the exclusive TypeScript engine for both the editor (LSP) and CLI (`typecheck` / `build`). Align Effect packages on the exact current **Effect v4 RC** and use **pnpm 11** workspace settings. Wire every Effect language-service rule as an **`error`** so the entire ruleset blocks CI when idiomatic Effect v4 patterns drift.

**Execute this plan step-by-step. Do NOT skip verification. Stop and report if any step fails.**

This command reflects the current configuration used by `@ballatech/effect-packages`: pnpm `11.22.0`, TypeScript `7.0.2`, `@effect/tsgo` `0.36.5`, and Effect `4.0.0-rc.110`. It is a pnpm monorepo whose library packages extend a shared `tsconfigs/` directory at the repo root. Resolve newer compatible versions when available; never mix unaligned Effect RC package versions.

---

## Context you must gather first

Before touching anything, run these in parallel and report findings:

1. Detect package manager: look for `pnpm-lock.yaml` → `pnpm`, `yarn.lock` → `yarn`, else `npm`. Use that for all install commands.
2. Detect workspace type: look for `pnpm-workspace.yaml`, `workspaces` field in root `package.json`, or `turbo.json`. If monorepo, list all packages under `packages/*`.
3. Find every `tsconfig*.json` in the repo (exclude `node_modules`, `dist`, `.repos`, `.pack`).
4. **Classify the tsconfig topology** for each `tsconfig*.json` found (this decides Phase 3.5 vs Phase 4):
   - **Leaf only**: no `extends`, all options inline → plugin goes directly into the file.
   - **Extends a local file** (`./tsconfig.base.json`, `../../tsconfigs/tsconfig.lib.json`, etc.) → plugin goes into the direct parent shared file; leaves inherit (see propagation gotcha below).
   - **Extends a workspace package** (a sibling package listed in `pnpm-workspace.yaml` / `workspaces`, e.g. `@my-scope/tsconfig/tsconfig.lib.json`) → edit that workspace package's shared config; leaves inherit.
   - **Extends an external published package** (e.g. `@ballatech/tsconfig/...`, `@tsconfig/node22`, etc.) → run Phase 3.5 (localize configs) before Phase 4.
   - For each leaf, note the extended path/package and resolve it to an absolute file so you can see what options are already set (`strict`, `plugins`, `moduleResolution`, etc.).
5. Read the root `package.json` to identify:
   - Current `typescript` devDependency version
   - Current `@effect/tsgo` version and its supported TypeScript versions
   - Scripts that invoke legacy `tsgo` instead of stable TypeScript 7's `tsc`
   - The `packageManager` field — this repo uses pnpm 11
   - `engines.node` — confirm Node ≥ 22 (this repo requires ≥ 24)
6. Check whether `typescript`, `@effect/tsgo`, and `.vscode/settings.json` exist. Treat `@typescript/native-preview` as a legacy package to migrate away from.
7. Read `pnpm-workspace.yaml` and check:
   - Effect RC catalog alignment
   - `peerDependencyRules` for prerelease peers
   - pnpm 11 `allowBuilds` policy (the removed `onlyBuiltDependencies` setting is invalid)
   - `minimumReleaseAgeExclude` entries added for intentionally adopted fresh releases

Report a short summary like:
```
Package manager: pnpm
Monorepo: yes (3 packages under packages/*)
tsconfigs found: 4 leaf + 5 shared
  tsconfigs/tsconfig.base.json                   (shared, no plugin)
  tsconfigs/tsconfig.lib.json                    (shared, OWNS plugin)
  tsconfigs/tsconfig.node22.json                 (shared, no plugin)
  tsconfigs/tsconfig.lambda22.json               (shared, no plugin)
  tsconfigs/tsconfig.react.json                  (shared, no plugin)
  packages/effect-lambda/tsconfig.json           → extends ../../tsconfigs/tsconfig.lib.json (LOCAL)
  packages/effect-problem-json/tsconfig.json     → extends ../../tsconfigs/tsconfig.lib.json (LOCAL)
  packages/effect-problem-json/tsconfig.dev.json → extends ./tsconfig.json                   (LOCAL, inherits plugin transitively via lib.json)
  packages/effect-oauth-client/tsconfig.json     → extends ../../tsconfigs/tsconfig.lib.json (LOCAL)
Current TypeScript: 7.0.2
Current @effect/tsgo: 0.36.5 (supports TypeScript 7.0.2)
Compiler scripts: all use tsc
Effect catalog: effect/@effect packages aligned on 4.0.0-rc.110
pnpm: 11.22.0; allowBuilds configured
Legacy @typescript/native-preview installed: no
Phase 3.5 needed: NO
```

Only then proceed.

---

## Phase 1 — Install dependencies

Install stable TypeScript 7 and `@effect/tsgo` as root **dev dependencies**. Do this once at the repo root even in monorepos to avoid compiler drift.

```bash
# pnpm
pnpm add -D -w typescript@7.0.2 @effect/tsgo@0.36.5

# npm
npm i -D typescript@7.0.2 @effect/tsgo@0.36.5

# yarn
yarn add -D typescript@7.0.2 @effect/tsgo@0.36.5
```

**Pinned working combination for this repo:**

```jsonc
{
  "@effect/tsgo": "^0.36.5",
  "typescript": "7.0.2"
}
```

Pin TypeScript exactly. `@effect/tsgo` only patches explicitly supported compiler builds. Before upgrading either package, read the installed `@effect/tsgo/README.md` “Supported Package Versions” table. `@effect/tsgo@0.36.5` supports TypeScript `7.0.2`; `@typescript/native-preview@latest` does not match it. `@typescript/native` is mentioned as an alias in upstream docs but is not currently published, so use the `typescript` package.

This repo does **not** use pnpm `catalog:` for these packages — they are pinned directly in the root `package.json` `devDependencies`. Keep it that way; catalog entries add a level of indirection that doesn't pay off for two packages.

After install, verify:

```bash
node -e "require.resolve('@effect/tsgo/package.json'); require.resolve('typescript/package.json'); console.log('ok')"
```

### Align Effect v4 RC packages

Resolve the exact `rc` dist-tag and ensure every non-consolidated `@effect/*` package uses the same version:

```bash
npm view effect@rc version
npm view @effect/platform-node@rc version
npm view @effect/platform-node-shared@rc version
npm view @effect/vitest@rc version
```

Current repo catalog:

```yaml
catalog:
  '@effect/platform-node': 4.0.0-rc.110
  '@effect/platform-node-shared': 4.0.0-rc.110
  '@effect/vitest': 4.0.0-rc.110
  effect: 4.0.0-rc.110
```

Do not install v4-consolidated umbrella packages separately (`@effect/schema`, `@effect/platform`, `@effect/rpc`, `@effect/cluster`, `@effect/sql`, `@effect/ai`).

If `@effect-aws/lambda@2.0.0-beta.5` is present, its stable-looking peer range excludes RC prereleases during pnpm 11 auto-resolution. Add `@effect/platform-node-shared: "catalog:"` directly to the consuming package and use the targeted workspace rule:

```yaml
peerDependencyRules:
  allowedVersions:
    '@effect-aws/lambda@2.0.0-beta.5>@effect/platform-node-shared': 4.0.0-rc.110
    '@effect-aws/lambda@2.0.0-beta.5>effect': 4.0.0-rc.110
```

### Configure pnpm 11

Pin pnpm in the root manifest:

```jsonc
{
  "packageManager": "pnpm@11.22.0"
}
```

Corepack may append a `+sha512...` integrity suffix; preserve it when present.

pnpm 11 removed `onlyBuiltDependencies` and enables strict dependency-build handling by default. Replace it with an explicit `allowBuilds` map:

```yaml
allowBuilds:
  esbuild: true
  msgpackr-extract: false
```

Allow `esbuild` because Vitest relies on its platform binary. Keep `msgpackr-extract` disabled: its native acceleration is optional and the package has a JavaScript fallback. Never allow all build scripts globally.

pnpm 11 also defaults to a one-day minimum release age. If an explicitly requested release is newer, add only the exact package versions needed under `minimumReleaseAgeExclude`; do not disable the policy repository-wide.

---

## Phase 2 — Patch stable TypeScript 7 with effect-tsgo

```bash
pnpm exec effect-tsgo patch
```

The patcher finds the installed `typescript` package, preserves its native compiler binary, and installs the Effect-patched compiler behind the package's normal `tsc` entry point. Verify:

```bash
pnpm exec tsc --version
# Expected: a version string ending in "+effect-tsgo.<sha>"
# If the output does NOT contain "+effect-tsgo", the patch did not apply.
```

Add a `postinstall` script to the root `package.json` so the patch is re-applied automatically whenever deps change (exact script used in this repo):

```jsonc
{
  "scripts": {
    "postinstall": "effect-tsgo patch || npx @effect/tsgo patch"
  }
}
```

The `npx` fallback handles cold installs where the local bin symlink is not yet resolvable. Do not pass `--typescript-package @typescript/native-preview`; that belongs to the retired preview-package setup. Re-run `<pkg-manager> install` once to confirm `postinstall` succeeds idempotently.

---

## Phase 3 — Migrate from native-preview / `tsgo` commands

Stable TypeScript 7 now provides the native compiler. The package is named `typescript`, and its public CLI remains `tsc`; there is no project `tsgo` command in this setup.

1. Remove `@typescript/native-preview` from every `package.json`.
2. Add exact `typescript: "7.0.2"` to the root `devDependencies`; do not duplicate it in workspace packages.
3. Replace every `tsgo` invocation in package scripts and documentation with `tsc`. The canonical leaf package scripts in this repo are:
   ```jsonc
   {
     "scripts": {
       "typecheck": "tsc -p tsconfig.dev.json",
       "build": "tsc -p tsconfig.json",
       "prepack": "pnpm run build"
     }
   }
   ```
   And the root orchestrator:
   ```jsonc
   {
     "scripts": {
       "typecheck": "pnpm -r --filter './packages/**' run typecheck",
       "build": "pnpm -r --filter './packages/**' run build"
     }
   }
   ```
4. Change `.vscode/settings.json` from `node_modules/@typescript/native-preview/lib` to `node_modules/typescript/lib`.
5. Remove explicit `--typescript-package @typescript/native-preview` arguments from patch commands.
6. Run the install command to refresh the lockfile and prune native-preview.

**Caveat (check before removing):** some adjacent dev tooling may still demand a TS peer dep:
- `vitest` + `@effect/vitest`: satisfied by the root `typescript` dependency.
- `tsx` / `ts-node`: check peers.
- `eslint-plugin-*` / `biome`: Biome does not need TypeScript, while ESLint typed rules do.
- `@effect/language-service` (old v3 LSP path): **remove this too** — the patched compiler embeds it. Do not keep both.

Run `<pkg-manager> install` and then `pnpm exec tsc --noEmit -p <any-tsconfig>` to confirm the patched stable compiler works.

---

## Phase 3.5 — Localize externally-shared tsconfigs (skip if not needed)

**Run this phase ONLY if the context scan flagged any leaf tsconfig as extending an external published package.** Otherwise jump to Phase 4.

This repo already ran Phase 3.5: the previously published `@ballatech/tsconfig` package was forked into the local `tsconfigs/` directory. Keep the layout as the reference:

```
tsconfigs/
  README.md
  tsconfig.base.json        ← root settings (strict, noUnusedLocals, isolatedModules, …). NO plugin.
  tsconfig.lib.json         ← extends ./tsconfig.base.json, OWNS the plugin block, used by every publishable lib leaf.
  tsconfig.node22.json      ← extends ./tsconfig.base.json, for Node-only apps/scripts (no emit).
  tsconfig.lambda22.json    ← extends ./tsconfig.base.json, for AWS Lambda handlers (no emit).
  tsconfig.react.json       ← extends ./tsconfig.base.json, for React apps / components (DOM lib, JSX).
```

Rationale: the Effect LSP plugin block is large and evolving. Putting it inside an external npm-published config forces a release of that package every time the ruleset changes, and silently opts every downstream consumer into a specific severity map. The clean separation is:

- **Base compiler options** (target, module, strict, etc.) → `tsconfig.base.json`.
- **Effect LSP plugin + severity map** → `tsconfig.lib.json`, travels with the source it protects.

Step-by-step if you need to redo it in another repo:

1. **Mirror the external configs locally.** For each external config referenced, resolve the file inside `node_modules/.pnpm/...` (pnpm) or `node_modules/@ext-pkg/...` (npm/yarn) and copy its contents verbatim to `tsconfigs/<same-basename>.json` at the repo root. Preserve the `extends` chain by rewriting external-package extends to the sibling local files (`"extends": "./tsconfig.base.json"`).
2. **Write a short `tsconfigs/README.md`** explaining what each variant is for and showing a one-line extends example (`"extends": "../../tsconfigs/tsconfig.lib.json"`). Include the extends-propagation gotcha described in Phase 4.
3. **Repoint every leaf `tsconfig.json`** from `"extends": "@ext-pkg/tsconfig.lib.json"` to the relative local path (`"extends": "../../tsconfigs/tsconfig.lib.json"`). Use the correct `../../` depth per package location.
4. **Drop the external package from every `devDependencies`** (leaf packages, root, shared configs). If the workspace uses a pnpm `catalog:` entry for it, remove that too.
5. **Scrub stale filters**: search the root `package.json` for any `--filter '!@ext-pkg/...'`, `-w '!@ext-pkg/...'`, or Turbo / Nx pipeline excludes that referenced the external config — delete them.
6. **Re-run `<pkg-manager> install`** to refresh the lockfile and prune the now-unused package.
7. **Verify**: run `<pkg-manager> run typecheck`. All packages must still pass. If they fail because a compiler option was only in the external file, compare against the copy in `tsconfigs/` — a setting was missed.

If the `extends` target is an **unpublished workspace package** rather than an external one, skip localization — just edit that workspace package's shared file directly in Phase 4.

---

## Phase 4 — Add the Effect LSP plugin

### Where the plugin goes — and why NOT in `tsconfig.base.json`

**Critical gotcha, empirically verified in this repo:** `compilerOptions.plugins` may fail to propagate through a **two-level** `extends` chain. With TypeScript `7.0.2` patched by `@effect/tsgo 0.36.5`, keep the plugin in the direct shared parent of each leaf. A chain like:

```
leaf tsconfig.json
  → ../../tsconfigs/tsconfig.lib.json
    → ./tsconfig.base.json    ← plugin defined here = SILENT NO-OP at the leaf
```

…produces a silent no-op. The leaf inherits every other compiler option but not the plugin, so Effect diagnostics never fire and your CI looks green while nothing is being checked.

**The plugin must therefore live in the direct parent of every leaf — `tsconfig.lib.json`, not `tsconfig.base.json`.**

Decision table:

| Topology | Where the plugin goes |
| --- | --- |
| Local `tsconfigs/tsconfig.lib.json` as direct parent of every lib leaf (this repo) | **One edit** to `tsconfig.lib.json`. Do NOT put it in `tsconfig.base.json`. |
| Workspace-owned shared config that is the direct parent of every leaf | **One edit** to that file. |
| Multiple shared variants (`tsconfig.node22.json`, `tsconfig.react.json`, …) with leaves extending each directly | Either (a) duplicate the plugin block into each variant, or (b) have each variant extend `tsconfig.lib.json` instead of `tsconfig.base.json`. Prefer (b). |
| Leaf-only tsconfigs with no shared base | Edit **each** leaf `tsconfig.json` individually. |
| Mixed: some leaves inherit, some don't | Edit the direct parent + each standalone leaf. |

Do NOT add the plugin to `tsconfig.dev.json` / `tsconfig.build.json` variants that already extend a base containing it — it would duplicate. Verify by resolving the `extends` chain first; note that because plugins only propagate one level, a `dev.json → leaf tsconfig.json → tsconfig.lib.json` chain already inherits the plugin correctly from the direct `./tsconfig.json` parent.

### Plugin configuration — errors only, no warning tier

This repo runs **every Effect language-service rule at `"error"`**, with `ignoreEffectSuggestionsInTscExitCode: false`. There is no soft/warning tier: the entire ruleset blocks `pnpm typecheck`. Lowering any rule severity requires deliberate justification in the commit.

Rationale: a warning tier trains humans and agents to ignore the signal. If a rule isn't load-bearing, remove it; if it is, make it fail the build.

Paste this block verbatim into the target tsconfig (merge into existing `compilerOptions`; do not overwrite unrelated keys):

```jsonc
{
  "compilerOptions": {
    "plugins": [
      {
        "name": "@effect/language-service",
        "ignoreEffectSuggestionsInTscExitCode": false,
        "diagnosticSeverity": {
          "anyUnknownInErrorContext": "error",
          "classSelfMismatch": "error",
          "duplicatePackage": "error",
          "effectFnImplicitAny": "error",
          "floatingEffect": "error",
          "floatingEffectInVitest": "error",
          "genericEffectServices": "error",
          "missingEffectContext": "error",
          "missingEffectError": "error",
          "missingLayerContext": "error",
          "missingReturnYieldStar": "error",
          "missingStarInYieldEffectGen": "error",
          "nonObjectEffectServiceType": "error",
          "outdatedApi": "error",
          "overriddenSchemaConstructor": "error",
          "promiseInEffectSuccess": "error",
          "schemaLiteralNonFinite": "error",
          "schemaOpaqueInstanceMember": "error",
          "catchUnfailableEffect": "error",
          "effectFnIife": "error",
          "effectGenUsesAdapter": "error",
          "effectInFailure": "error",
          "effectInVoidSuccess": "error",
          "globalErrorInEffectCatch": "error",
          "globalErrorInEffectFailure": "error",
          "layerMergeAllWithDependencies": "error",
          "lazyEffect": "error",
          "lazyPromiseInEffectSync": "error",
          "leakingRequirements": "error",
          "multipleEffectProvide": "error",
          "preferUnsafeConstructor": "error",
          "returnEffectInGen": "error",
          "runEffectInsideEffect": "error",
          "schemaSyncInEffect": "error",
          "scopeInLayerEffect": "error",
          "strictEffectProvide": "error",
          "tryCatchInEffectGen": "error",
          "unknownInEffectCatch": "error",
          "abortControllerInEffect": "error",
          "asyncFunction": "error",
          "cryptoRandomUUID": "error",
          "cryptoRandomUUIDInEffect": "error",
          "extendsNativeError": "error",
          "globalConsole": "error",
          "globalConsoleInEffect": "error",
          "globalDate": "error",
          "globalDateInEffect": "error",
          "globalFetch": "error",
          "globalFetchInEffect": "error",
          "globalRandom": "error",
          "globalRandomInEffect": "error",
          "globalTimers": "error",
          "globalTimersInEffect": "error",
          "instanceOfSchema": "error",
          "newPromise": "error",
          "nodeBuiltinImport": "error",
          "preferSchemaOverJson": "error",
          "processEnv": "error",
          "processEnvInEffect": "error",
          "unsafeEffectTypeAssertion": "error",
          "catchAllToMapError": "error",
          "catchChainToFirstSuccessOf": "error",
          "catchTagToCatchReason": "error",
          "catchToIgnore": "error",
          "catchToOrElseSucceed": "error",
          "deterministicKeys": "error",
          "effectDoNotation": "error",
          "effectFnOpportunity": "error",
          "effectMapFlatten": "error",
          "effectMapVoid": "error",
          "effectSucceedWithVoid": "error",
          "flatMapToMap": "error",
          "missedPipeableOpportunity": "error",
          "missingEffectServiceDependency": "error",
          "missingPipeableSignature": "error",
          "multipleCatchTag": "error",
          "nestedEffectGenYield": "error",
          "newSchemaClass": "error",
          "preferSchemaTypeProperty": "error",
          "preferTypedSchemaDecoder": "error",
          "redundantMapError": "error",
          "redundantOrDie": "error",
          "redundantSchemaTagIdentifier": "error",
          "schemaNumber": "error",
          "schemaStructWithTag": "error",
          "schemaUnionOfLiterals": "error",
          "serviceNotAsClass": "error",
          "strictBooleanExpressions": "error",
          "syncToSucceed": "error",
          "unnecessaryArrowBlock": "error",
          "unnecessaryEffectGen": "error",
          "unnecessaryFailYieldableError": "error",
          "unnecessaryPipe": "error",
          "unnecessaryPipeChain": "error",
          "unnecessaryTypeofType": "error"
        }
      }
    ]
  }
}
```

Notes for the agent while editing tsconfigs:
- Preserve formatting and existing options. Merge the `plugins` array; do not overwrite unrelated keys.
- If a `plugins` array already exists and already contains `@effect/language-service`, replace that entry entirely with the block above.
- Never duplicate plugin entries. If the plugin already lives in the direct parent shared tsconfig, do NOT re-add it in leaves.
- This repo intentionally does **not** use a `refactors` / `diagnostics` / `quickinfo` / `completions` / `goto` / `renames` / `inlays` keyset — those default to `true` on recent `@effect/language-service` and specifying them adds drift with upstream.
- This repo intentionally does **not** use an `overrides` block to bump severities inside `src/**`, because every rule is already at `"error"` repo-wide. If a downstream repo wants a split-severity model, use `overrides` as described in the `@effect/language-service` docs.
- On every `@effect/tsgo` upgrade, compare the installed README's Diagnostic Status table with `diagnosticSeverity` and explicitly add new rules as `"error"`. Version `0.36.5` introduced rules such as `flatMapToMap` and `preferTypedSchemaDecoder`; relying only on defaults silently creates a mixed error/suggestion policy.
- After editing, run the smoke test in Phase 6 — introducing a floating Effect should fail typecheck with `TS377001 effect(floatingEffect)`.

---

## Phase 5 — Configure VS Code / Cursor to use patched TypeScript 7

Create or merge `.vscode/settings.json`. This repo's exact contents:

```jsonc
{
  "editor.codeActionsOnSave": {
    "source.fixAll": "never",
    "source.fixAll.biome": "explicit",
    "source.organizeImports": "never",
    "source.organizeImports.biome": "explicit"
  },
  "editor.defaultFormatter": "biomejs.biome",
  "editor.formatOnSave": true,

  "typescript.experimental.useTsgo": true,
  "typescript.tsdk": "node_modules/typescript/lib",
  "typescript.enablePromptUseWorkspaceTsdk": true,
  "typescript.tsserver.experimental.enableProjectDiagnostics": true,
  "typescript.tsserver.useSyntaxServer": "never",

  "typescript.preferences.organizeImports": { "enabled": false },
  "javascript.preferences.organizeImports": { "enabled": false }
}
```

Key points:
- `typescript.experimental.useTsgo: true` routes the LSP through the native TypeScript 7 engine.
- `typescript.tsdk: "node_modules/typescript/lib"` pins the editor to the patched local compiler so every contributor gets the same diagnostics.
- `typescript.tsserver.experimental.enableProjectDiagnostics: true` is required so the Effect LSP sees missing context / unused values on files you haven't opened.
- `typescript.tsserver.useSyntaxServer: "never"` — use this, not the deprecated `useSeparateSyntaxServer`. The separate syntax server strips the plugin's diagnostics in some editor code paths; disabling it forces every query through the semantic server where the plugin runs.
- Biome-related keys must be preserved — this repo formats & organizes imports via Biome, not the TS server. Merge, don't replace.

Create `.vscode/extensions.json` to recommend the required extension:

```jsonc
{
  "recommendations": ["TypeScriptTeam.native-preview", "biomejs.biome"]
}
```

(Keep any existing recommendations in the array.)

The extension ID remains `TypeScriptTeam.native-preview`; that is the current editor integration name even though the compiler package is stable `typescript@7`.

---

## Phase 6 — Verification loop

Run each of these and fix failures before moving on:

```bash
pnpm exec tsc --version             # Must end in "+effect-tsgo.<sha>"
pnpm exec tsc --noEmit -p <a-tsconfig> # Typechecks successfully
<pkg-manager> run typecheck         # All packages typecheck through patched tsc
<pkg-manager> run test              # Tests still pass
<pkg-manager> run format            # Formatting/config validation passes
```

**Plugin-is-actually-loaded smoke test.** The extends-propagation gotcha fails silently, so this check is non-negotiable. Drop this into a leaf package's `src/`:

```ts
import { Effect } from "effect"
export const check = () => {
  Effect.succeed(1)
  return undefined
}
```

Run `pnpm exec tsc -p <leaf-tsconfig>` — it **must** fail with `TS377001 effect(floatingEffect)`. If it passes, the plugin is not being loaded; revisit Phase 4 and make sure the plugin block lives in the **direct** parent of the leaf, not two levels up.

Revert the smoke-test file before committing.

If the repo has `format` / `lint` scripts, run them and commit any autoformat changes.

If any script still references the obsolete `tsgo` binary or any file references `@typescript/native-preview`, fix it.

---

## Phase 7 — Document the change

Append a short section to the repo's `AGENTS.md` (or `CLAUDE.md`, whichever exists — create `AGENTS.md` if neither does) titled `## TypeScript toolchain`. Use this repo's exact wording as the template:

```markdown
## TypeScript toolchain

- This repo compiles and typechecks with stable `typescript` v7 patched by `@effect/tsgo` (config in `tsconfigs/`). If `pnpm exec tsc --version` does not end in `+effect-tsgo.*`, run `pnpm exec effect-tsgo patch`.
- Every Effect language-service rule is set to `error`, with `ignoreEffectSuggestionsInTscExitCode: false` — there is no soft/warning tier, the entire ruleset blocks `pnpm typecheck`. Lowering any rule severity requires deliberate justification in the commit.
- The plugin block lives in `tsconfigs/tsconfig.lib.json`, NOT in `tsconfig.base.json`, because `compilerOptions.plugins` may not propagate through a two-level `extends` chain. When adding a new variant in `tsconfigs/`, either extend `tsconfig.lib.json` from it or duplicate the plugin block — see `tsconfigs/README.md` for the smoke test.
- Effect v4 RC packages are pinned to one exact aligned RC in the pnpm catalog. pnpm 11 build-script and prerelease-peer exceptions are explicit and narrowly scoped in `pnpm-workspace.yaml`.
```

Update the version numbers if the pinned combination drifts.

---

## Final report

Produce a concise summary for the user covering:

- Installed versions of stable `typescript` and `@effect/tsgo`, plus confirmation that the exact TypeScript build appears in the installed tsgo compatibility table.
- Exact Effect RC used by `effect` and each `@effect/*` catalog dependency; confirm they are aligned.
- pnpm version and any `peerDependencyRules`, `minimumReleaseAgeExclude`, or `allowBuilds` exceptions added, including why each exception is necessary.
- Tsconfig handling:
  - Topology detected (leaf-only / local-shared / workspace-shared / external)
  - Whether Phase 3.5 ran; if so, which external packages were localized and which configs were created under `tsconfigs/`
  - Final location of the `@effect/language-service` plugin (confirm it is the **direct** parent of every leaf, not a grandparent)
  - Number of leaf tsconfigs inheriting it vs. edited directly
  - Confirmation the `tsconfig.base.json` does NOT contain the plugin (only the direct parent does)
- Scripts migrated from `tsgo` → patched TypeScript 7's `tsc` (leaf scripts + root orchestrator).
- Whether `@typescript/native-preview` was removed from manifests, lockfile, patch commands, editor settings, and documentation.
- Whether the old `@effect/language-service` standalone package was removed.
- Total number of Effect diagnostics enabled (count from the `diagnosticSeverity` object). All should be `"error"` in this repo's model.
- Confirmation the floating-effect smoke test fails typecheck in at least one leaf (proving the plugin is live).
- Any rules the agent decided to downgrade from `error` and the commit-level justification.
- Suggested follow-up: reload the VS Code window so the TSGo extension picks up `node_modules/typescript/lib`.
