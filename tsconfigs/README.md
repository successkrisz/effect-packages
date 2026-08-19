# Shared TypeScript configs

Local, in-repo replacements for the previously published `@ballatech/tsconfig` package.

Packages extend these via a relative path from their own `tsconfig.json`, e.g.:

```jsonc
{
	"extends": "../../tsconfigs/tsconfig.lib.json"
}
```

| File | Use for |
| --- | --- |
| `tsconfig.base.json` | Root settings shared by every variant (`strict`, `noUnusedLocals`, `isolatedModules`, …). Deliberately does **not** define `compilerOptions.plugins` — see gotcha below. |
| `tsconfig.lib.json` | Publishable libraries — emits declarations, `outDir: dist`, and **owns** the full `@effect/language-service` plugin block (all 68 rules at `error`, `ignoreEffectSuggestionsInTscExitCode: false` for maximum strictness). |
| `tsconfig.node22.json` | Node-only apps/scripts (no emit) |
| `tsconfig.lambda22.json` | AWS Lambda handlers (no emit, Node runtime) |
| `tsconfig.react.json` | React apps / components (DOM lib, JSX) |

## Extends-propagation gotcha (important)

`compilerOptions.plugins` only propagates through a **single** `extends` level. A chain like `leaf → tsconfig.lib.json → tsconfig.base.json` with the plugin defined in `base.json` produces a silent no-op — the leaf inherits every other option but not the plugin. Empirically verified against `@effect/tsgo 0.4.0` / `@typescript/native-preview 7.0.0-dev.20260417.1`.

Therefore the plugin block lives in `tsconfig.lib.json` (the direct parent of every current package leaf), not in `tsconfig.base.json`. If you introduce another variant (`tsconfig.node22.json`, `tsconfig.react.json`, …) and a leaf extends it directly, duplicate the plugin block into that variant too — or extend from `tsconfig.lib.json` instead of `tsconfig.base.json`.

Quick smoke test to confirm enforcement in any leaf:

```ts
import { Effect } from "effect"
export const check = () => { Effect.succeed(1); return undefined }
```

Running `pnpm exec tsc -p <leaf>` on a file containing the above should fail with `TS377001 effect(floatingEffect)`. If it passes, the plugin isn't being loaded.
