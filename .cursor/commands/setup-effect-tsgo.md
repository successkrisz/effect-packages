# Setup Effect TSGo (native-preview + @effect/tsgo)

Configure this repository to use **TypeScript-Go Native Preview** patched with **`@effect/tsgo`** as the exclusive TypeScript engine — both for the editor (LSP) and for the CLI (typecheck/build). Wire up every Effect language-service rule as a **warning** so strong back-pressure guides both humans and coding agents toward idiomatic Effect v4 patterns.

**Execute this plan step-by-step. Do NOT skip verification. Stop and report if any step fails.**

---

## Context you must gather first

Before touching anything, run these in parallel and report findings:

1. Detect package manager: look for `pnpm-lock.yaml` → `pnpm`, `yarn.lock` → `yarn`, else `npm`. Use that for all install commands.
2. Detect workspace type: look for `pnpm-workspace.yaml`, `workspaces` field in root `package.json`, or `turbo.json`. If monorepo, list all packages under `packages/*`.
3. Find every `tsconfig*.json` in the repo (exclude `node_modules`, `dist`, `.repos`, `.pack`).
4. **Classify the tsconfig topology** for each `tsconfig*.json` found (this decides Phase 3.5 vs Phase 4):
   - **Leaf only**: no `extends`, all options inline → plugin goes directly into the file.
   - **Extends a local file** (`./tsconfig.base.json`, `../../tsconfigs/tsconfig.lib.json`, etc.) → plugin goes into the shared local file; leaves inherit.
   - **Extends a workspace package** (a sibling package listed in `pnpm-workspace.yaml` / `workspaces`, e.g. `@my-scope/tsconfig/tsconfig.lib.json`) → edit that workspace package's shared config; leaves inherit.
   - **Extends an external published package** (e.g. `@ballatech/tsconfig/...`, `@tsconfig/node22`, etc.) → run Phase 3.5 (localize configs) before Phase 4.
   - For each leaf, note the extended path/package and resolve it to an absolute file so you can see what options are already set (`strict`, `plugins`, `moduleResolution`, etc.).
5. Read the root `package.json` to identify:
   - Current `typescript` devDependency version
   - Scripts that invoke `tsc` (typecheck, build, etc.)
   - `engines.node` — confirm Node ≥ 20
6. Check if `@typescript/native-preview` and `@effect/tsgo` are already installed and whether `.vscode/settings.json` exists.

Report a short summary like:
```
Package manager: pnpm
Monorepo: yes (3 packages)
tsconfigs found: 4 total
  packages/effect-lambda/tsconfig.json         → extends @ballatech/tsconfig/tsconfig.lib.json  (EXTERNAL)
  packages/effect-problem-json/tsconfig.json   → extends @ballatech/tsconfig/tsconfig.lib.json  (EXTERNAL)
  packages/effect-problem-json/tsconfig.dev.json → extends ./tsconfig.json                      (LOCAL)
  packages/effect-oauth-client/tsconfig.json   → extends @ballatech/tsconfig/tsconfig.lib.json  (EXTERNAL)
Current typescript: ^5.9.3
tsc-using scripts: typecheck, build (per package)
Already installed: @typescript/native-preview no, @effect/tsgo no
Phase 3.5 needed: YES (all leaves extend an external package)
```

Only then proceed.

---

## Phase 1 — Install dependencies

Install both packages as root **dev dependencies**. Do this once at the repo root even in monorepos (binaries are hoisted; avoids version drift).

```bash
# pnpm
pnpm add -D -w @typescript/native-preview @effect/tsgo

# npm
npm i -D @typescript/native-preview @effect/tsgo

# yarn
yarn add -D @typescript/native-preview @effect/tsgo
```

**Required package versions:** resolve the latest compatible versions with the `@typescript/native-preview` commit that `@effect/tsgo` pins. If the repo has a skill called `effect-v4-package-version-tracker`, read and follow it first. Otherwise install the `latest` tag of both.

If the repo uses a pnpm `catalog:`, add the new packages there as well and reference them from the root `package.json` using `catalog:`.

After install, verify:

```bash
node -e "require.resolve('@effect/tsgo/package.json'); require.resolve('@typescript/native-preview/package.json'); console.log('ok')"
```

---

## Phase 2 — Patch the tsgo binary with effect-tsgo

```bash
npx @effect/tsgo patch
```

This renames `node_modules/@typescript/native-preview/<platform>/tsgo` → `tsgo.original` and drops the effect-patched binary in its place. Verify:

```bash
npx tsgo --version
# Should print a version and mention effect — NOT a vanilla tsgo build
```

Add a `postinstall` script to the root `package.json` so the patch is re-applied automatically whenever deps change:

```jsonc
{
  "scripts": {
    "postinstall": "effect-tsgo patch || npx @effect/tsgo patch"
  }
}
```

Re-run `<pkg-manager> install` once to confirm `postinstall` succeeds idempotently.

---

## Phase 3 — Remove the legacy `typescript` package

The goal is **tsgo only**. Remove the JS-based compiler so nothing can silently fall back to it.

1. Remove the `typescript` entry from every `package.json` in the repo (root + each workspace package + shared config packages).
2. If the repo has a `pnpm-workspace.yaml` `catalog:` entry for `typescript`, delete that entry too.
3. Delete `typescript` from lockfile by running the install command again (e.g. `pnpm install`).
4. Replace every `tsc` invocation in `scripts` with `tsgo`:
   - `"typecheck": "tsc -p tsconfig.json"` → `"typecheck": "tsgo -p tsconfig.json --noEmit"`
   - `"build": "tsc -p tsconfig.build.json"` → `"build": "tsgo -p tsconfig.build.json"`
   - `"tsc": "tsc"` → `"tsc": "tsgo"` (keep the alias name if tooling expects it)
5. Search the repo for any lingering `./node_modules/typescript` references (e.g. in old `.vscode/settings.json`) and remove them.

**Caveat (check before removing):** some adjacent dev tooling may still demand a TS peer dep:
- `vitest` + `@effect/vitest`: usually fine, they read types from the TS server at runtime not the `typescript` package
- `tsx` / `ts-node`: check peers
- `eslint-plugin-*` / `biome`: Biome does not need `typescript`. ESLint typed rules DO need it.
- `@effect/language-service` (old v3 LSP path): **remove this too** — the patched tsgo provides it natively. Do not keep both.

If a tool genuinely requires `typescript`, keep it as a transitive via the tool's own peer, but do **not** list it as a direct devDependency.

Run `<pkg-manager> install` and then `npx tsgo --noEmit -p <any-tsconfig>` to confirm the CLI still works without the old `typescript` package.

---

## Phase 3.5 — Localize externally-shared tsconfigs (skip if not needed)

**Run this phase ONLY if the context scan flagged any leaf tsconfig as extending an external published package.** Otherwise jump to Phase 4.

Rationale: the Effect LSP plugin block is large and evolving. Putting it inside an external npm-published config forces a release of that package every time the ruleset changes, and it silently opts every downstream consumer into a specific severity map. The clean separation is:

- **Base compiler options** (target, module, strict, etc.) → may live externally or locally, your call.
- **Effect LSP plugin + severity map** → always lives in the current repo, so iteration stays fast and the config travels with the source it protects.

The cheapest fix is to fork the external base into a local `tsconfigs/` directory at the repo root.

Step-by-step:

1. **Mirror the external configs locally.** For each external config referenced (`@ext-pkg/tsconfig.lib.json`, `@ext-pkg/tsconfig.base.json`, etc.), resolve the file inside `node_modules/.pnpm/...` (pnpm) or `node_modules/@ext-pkg/...` (npm/yarn) and copy its contents verbatim to `tsconfigs/<same-basename>.json` at the repo root. Preserve the `extends` chain by rewriting external-package extends to the sibling local files (`"extends": "./tsconfig.base.json"`).
2. **Write a short `tsconfigs/README.md`** explaining what each variant is for and showing a one-line extends example (`"extends": "../../tsconfigs/tsconfig.lib.json"`).
3. **Repoint every leaf `tsconfig.json`** from `"extends": "@ext-pkg/tsconfig.lib.json"` to the relative local path (`"extends": "../../tsconfigs/tsconfig.lib.json"`). Use the correct `../../` depth per package location.
4. **Drop the external package from every `devDependencies`** (leaf packages, root, shared configs). If the workspace uses a pnpm `catalog:` entry for it, remove that too.
5. **Scrub stale filters**: search the root `package.json` for any `--filter '!@ext-pkg/...'`, `-w '!@ext-pkg/...'`, or Turbo / Nx pipeline excludes that referenced the external config — delete them.
6. **Re-run `<pkg-manager> install`** to refresh the lockfile and prune the now-unused package.
7. **Verify**: run `<pkg-manager> run typecheck`. All packages must still pass. If they fail because a compiler option was only in the external file, compare against the copy in `tsconfigs/` — a setting was missed.

Only one local file needs the plugin: `tsconfigs/tsconfig.base.json` (everything else extends it). This keeps Phase 4 a single-file edit no matter how many packages exist.

If the `extends` target is an **unpublished workspace package** rather than an external one, skip localization — just edit that workspace package's shared file directly in Phase 4.

---

## Phase 4 — Add the Effect LSP plugin

Decide where to write the plugin block using the classification from the context scan:

| Topology | Where the plugin goes |
| --- | --- |
| Local `tsconfigs/tsconfig.base.json` (post-3.5 or pre-existing) | **One edit** to that file. Every leaf inherits. |
| Workspace-owned shared config (e.g. `packages/tsconfig/tsconfig.base.json`) | **One edit** to that file. Every leaf inherits. |
| Leaf-only tsconfigs with no shared base | Edit **each** leaf `tsconfig.json` individually. |
| Mixed: some leaves inherit, some don't | Edit the shared base + each standalone leaf. |

Do NOT add the plugin to `tsconfig.dev.json` / `tsconfig.build.json` variants that already extend a base containing it — it would duplicate. Verify by resolving the `extends` chain first.

Use **this exact plugin configuration** — it enables every known Effect diagnostic as `"warning"` severity so agents and humans see the signal without blocking the build. The `overrides` block escalates critical correctness rules inside `src/**` to `error` so they DO fail CI.

```jsonc
{
  "compilerOptions": {
    "plugins": [
      {
        "name": "@effect/language-service",
        "refactors": true,
        "diagnostics": true,
        "quickinfo": true,
        "completions": true,
        "goto": true,
        "renames": true,
        "inlays": true,
        "includeSuggestionsInTsc": true,
        "ignoreEffectSuggestionsInTscExitCode": true,
        "ignoreEffectWarningsInTscExitCode": true,
        "ignoreEffectErrorsInTscExitCode": false,
        "pipeableMinArgCount": 2,
        "effectFn": ["span"],
        "diagnosticSeverity": {
          "anyUnknownInErrorContext": "warning",
          "classSelfMismatch": "warning",
          "duplicatePackage": "warning",
          "effectFnImplicitAny": "warning",
          "floatingEffect": "warning",
          "genericEffectServices": "warning",
          "missingEffectContext": "warning",
          "missingEffectError": "warning",
          "missingLayerContext": "warning",
          "missingReturnYieldStar": "warning",
          "missingStarInYieldEffectGen": "warning",
          "overriddenSchemaConstructor": "warning",
          "catchUnfailableEffect": "warning",
          "effectFnIife": "warning",
          "effectGenUsesAdapter": "warning",
          "effectInFailure": "warning",
          "effectInVoidSuccess": "warning",
          "globalErrorInEffectCatch": "warning",
          "globalErrorInEffectFailure": "warning",
          "layerMergeAllWithDependencies": "warning",
          "lazyPromiseInEffectSync": "warning",
          "leakingRequirements": "warning",
          "multipleEffectProvide": "warning",
          "returnEffectInGen": "warning",
          "runEffectInsideEffect": "warning",
          "strictEffectProvide": "warning",
          "tryCatchInEffectGen": "warning",
          "unknownInEffectCatch": "warning",
          "asyncFunction": "warning",
          "extendsNativeError": "warning",
          "globalConsole": "warning",
          "globalConsoleInEffect": "warning",
          "globalDate": "warning",
          "globalDateInEffect": "warning",
          "globalFetch": "warning",
          "globalFetchInEffect": "warning",
          "globalRandom": "warning",
          "globalRandomInEffect": "warning",
          "globalTimers": "warning",
          "globalTimersInEffect": "warning",
          "instanceOfSchema": "warning",
          "newPromise": "warning",
          "nodeBuiltinImport": "warning",
          "preferSchemaOverJson": "warning",
          "processEnv": "warning",
          "processEnvInEffect": "warning",
          "catchAllToMapError": "warning",
          "deterministicKeys": "warning",
          "effectDoNotation": "warning",
          "effectFnOpportunity": "warning",
          "effectMapFlatten": "warning",
          "effectMapVoid": "warning",
          "effectSucceedWithVoid": "warning",
          "missedPipeableOpportunity": "warning",
          "nestedEffectGenYield": "warning",
          "redundantSchemaTagIdentifier": "warning",
          "schemaStructWithTag": "warning",
          "strictBooleanExpressions": "warning",
          "unnecessaryArrowBlock": "warning",
          "unnecessaryEffectGen": "warning",
          "unnecessaryFailYieldableError": "warning",
          "unnecessaryPipe": "warning",
          "unnecessaryPipeChain": "warning"
        },
        "overrides": [
          {
            "include": ["src/**/*.ts", "src/**/*.tsx"],
            "options": {
              "diagnosticSeverity": {
                "floatingEffect": "error",
                "missingEffectError": "error",
                "missingEffectContext": "error",
                "missingLayerContext": "error",
                "classSelfMismatch": "error",
                "overriddenSchemaConstructor": "error"
              }
            }
          }
        ]
      }
    ]
  }
}
```

Notes for the agent while editing tsconfigs:
- Preserve formatting and existing options. Merge the `plugins` array; do not overwrite unrelated keys.
- If a `plugins` array already exists and already contains `@effect/language-service`, replace that entry entirely with the block above.
- Never duplicate plugin entries. If the plugin already lives in a shared base, do NOT re-add it in leaves.
- The `overrides[].include` globs are relative to **the tsconfig file that defines them**. When the plugin lives in a shared `tsconfigs/tsconfig.base.json` at the repo root, `src/**/*.ts` still resolves correctly per-project because the LSP evaluates includes against each resolved project root — but if in doubt, prefer placing the plugin block as close to the source as possible (the base in a monorepo with a single `src/` convention is fine; a wildly heterogeneous monorepo may need per-leaf plugin blocks).
- Some rule names listed above are v3-only. The Language Service safely ignores unknown rule names, so keeping them future-proofs the config.
- After editing, open one representative `.ts` file in the editor and confirm at least one Effect diagnostic shows up (introduce a `console.log` in an `Effect.gen` if needed as a smoke test, then revert).

---

## Phase 5 — Configure VS Code / Cursor to use the local tsgo

Create or merge `.vscode/settings.json`:

```jsonc
{
  // Enable TypeScript Native Preview (tsgo) as the LSP
  "typescript.experimental.useTsgo": true,

  // Point at the LOCAL copy inside node_modules so every contributor uses the patched binary
  "typescript.tsdk": "node_modules/@typescript/native-preview/lib",
  "typescript.enablePromptUseWorkspaceTsdk": true,

  // Full-project diagnostics — required so Effect LSP sees unused/missing context on files you haven't opened
  "typescript.tsserver.experimental.enableProjectDiagnostics": true,

  // Silence the legacy tsserver organize-imports since the tsgo path runs its own
  "typescript.preferences.organizeImports": { "enabled": false },
  "javascript.preferences.organizeImports": { "enabled": false },

  // Recommend workspace-local tsdk prompt on open
  "typescript.tsserver.useSeparateSyntaxServer": false
}
```

Preserve any existing keys such as the Biome formatter settings. Do a merge, not a replace.

Create `.vscode/extensions.json` to recommend the required extension:

```jsonc
{
  "recommendations": [
    "TypeScriptTeam.native-preview",
    "biomejs.biome"
  ]
}
```

(Keep any existing recommendations in the array.)

---

## Phase 6 — Verification loop

Run each of these and fix failures before moving on:

```bash
npx tsgo --version                  # Prints effect-patched version
npx tsgo --noEmit -p <a-tsconfig>   # Typechecks successfully
<pkg-manager> run typecheck         # All packages typecheck through tsgo
<pkg-manager> run test              # Tests still pass
```

If the repo has `format` / `lint` scripts, run them and commit any autoformat changes.

If any script still references `tsc` after your edits, fix it.

---

## Phase 7 — Document the change

Append a short section to the repo's `AGENTS.md` (or `CLAUDE.md`, whichever exists — create `AGENTS.md` if neither does) titled `## TypeScript toolchain`:

```markdown
## TypeScript toolchain

This repo uses **`@typescript/native-preview` patched by `@effect/tsgo`** as its sole TypeScript engine.

- `npx tsgo` runs the Effect-patched compiler (diagnostics + refactors + quickfixes).
- The standard `typescript` package is intentionally NOT a direct dependency.
- After any dependency change, `postinstall` re-applies the patch; if you see vanilla tsgo output, run `npx @effect/tsgo patch` manually.
- The VS Code / Cursor LSP uses the same local binary via `typescript.experimental.useTsgo: true`.
- All Effect LSP rules are configured in each `tsconfig.json` as warnings; a curated subset escalates to errors inside `src/**`.
- Agents: prefer Effect-native APIs whenever a `globalX` / `globalXInEffect` warning appears. Warnings are load-bearing.
```

---

## Final report

Produce a concise summary for the user covering:

- Installed package versions (`@typescript/native-preview`, `@effect/tsgo`)
- Tsconfig handling:
  - Topology detected (leaf-only / local-shared / workspace-shared / external)
  - Whether Phase 3.5 ran; if so, which external packages were localized and which configs were created under `tsconfigs/`
  - Final location(s) where the `@effect/language-service` plugin now lives
  - Number of leaf tsconfigs inheriting it vs. edited directly
- Scripts migrated from `tsc` → `tsgo`
- Whether `typescript` was removed and from where
- Whether the old `@effect/language-service` standalone package was removed
- Total number of Effect diagnostics enabled (count from the `diagnosticSeverity` object) and which ones were escalated to `error` inside `src/**`
- Any warnings the agent decided to leave as-is and why
- Suggested follow-up: reload the VS Code window so the TSGo extension picks up the new tsdk
