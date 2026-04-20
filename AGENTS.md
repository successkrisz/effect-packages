# This a repository for libararies using effect

- Use `pnpm` as the package manager and task runner.
- Available project commands:
  - `pnpm run test`
  - `pnpm run typecheck`
  - `pnpm run format`
- Never run commands in watch mode or start long-running dev servers.
- Do not run `pnpm run test:watch`.
- Do not start a dev server unless the user explicitly asks for it.
- Run `pnpm run typecheck` and `pnpm run format` after code changes.
- Run `pnpm run test` when behavior changes or tests are added.
- When complated your code changes and `typecheck`, `format` and `test` all work trigger the `/effect-smol-qu-reviewer` to provide feedback on your changes

## Effect Reference Repository

You have access to the Effect repository at `./.repos/effect`.

- Use `./.repos/effect` to extract best practices before introducing new patterns.
- Look at `./.repos/effect/AGENTS.md` for repository-specific guidance from the upstream project.
- Look at existing code in `./.repos/effect` to understand how Effect APIs are typically structured and tested.
- Prefer following upstream Effect conventions when this workshop repo does not yet establish its own pattern.
- Treat `./.repos/effect` as a reference implementation unless the task explicitly requires editing it.

## TypeScript toolchain

- This repo compiles and typechecks exclusively via `@typescript/native-preview` patched by `@effect/tsgo` (config in `tsconfigs/`). If `npx tsgo --version` does not end in `+effect-tsgo.*`, run `npx @effect/tsgo patch`.
- Every Effect language-service rule is set to `error`, with `ignoreEffectSuggestionsInTscExitCode: false` — there is no soft/warning tier, the entire ruleset blocks `pnpm typecheck`. Lowering any rule severity requires deliberate justification in the commit.
- The plugin block lives in `tsconfigs/tsconfig.lib.json`, NOT in `tsconfig.base.json`, because `compilerOptions.plugins` does not propagate through a 2-level `extends` chain with `@effect/tsgo` 0.4.0. When adding a new variant in `tsconfigs/`, either extend `tsconfig.lib.json` from it or duplicate the plugin block — see `tsconfigs/README.md` for the smoke test.

<!-- gitnexus:start -->
# GitNexus — Code Intelligence

This project is indexed by GitNexus as **effect-packages** (290 symbols, 467 relationships, 6 execution flows). Use the GitNexus MCP tools to understand code, assess impact, and navigate safely.

> If any GitNexus tool warns the index is stale, run `npx gitnexus analyze` in terminal first.

## Always Do

- **MUST run impact analysis before editing any symbol.** Before modifying a function, class, or method, run `gitnexus_impact({target: "symbolName", direction: "upstream"})` and report the blast radius (direct callers, affected processes, risk level) to the user.
- **MUST run `gitnexus_detect_changes()` before committing** to verify your changes only affect expected symbols and execution flows.
- **MUST warn the user** if impact analysis returns HIGH or CRITICAL risk before proceeding with edits.
- When exploring unfamiliar code, use `gitnexus_query({query: "concept"})` to find execution flows instead of grepping. It returns process-grouped results ranked by relevance.
- When you need full context on a specific symbol — callers, callees, which execution flows it participates in — use `gitnexus_context({name: "symbolName"})`.

## When Debugging

1. `gitnexus_query({query: "<error or symptom>"})` — find execution flows related to the issue
2. `gitnexus_context({name: "<suspect function>"})` — see all callers, callees, and process participation
3. `READ gitnexus://repo/effect-packages/process/{processName}` — trace the full execution flow step by step
4. For regressions: `gitnexus_detect_changes({scope: "compare", base_ref: "main"})` — see what your branch changed

## When Refactoring

- **Renaming**: MUST use `gitnexus_rename({symbol_name: "old", new_name: "new", dry_run: true})` first. Review the preview — graph edits are safe, text_search edits need manual review. Then run with `dry_run: false`.
- **Extracting/Splitting**: MUST run `gitnexus_context({name: "target"})` to see all incoming/outgoing refs, then `gitnexus_impact({target: "target", direction: "upstream"})` to find all external callers before moving code.
- After any refactor: run `gitnexus_detect_changes({scope: "all"})` to verify only expected files changed.

## Never Do

- NEVER edit a function, class, or method without first running `gitnexus_impact` on it.
- NEVER ignore HIGH or CRITICAL risk warnings from impact analysis.
- NEVER rename symbols with find-and-replace — use `gitnexus_rename` which understands the call graph.
- NEVER commit changes without running `gitnexus_detect_changes()` to check affected scope.

## Tools Quick Reference

| Tool | When to use | Command |
|------|-------------|---------|
| `query` | Find code by concept | `gitnexus_query({query: "auth validation"})` |
| `context` | 360-degree view of one symbol | `gitnexus_context({name: "validateUser"})` |
| `impact` | Blast radius before editing | `gitnexus_impact({target: "X", direction: "upstream"})` |
| `detect_changes` | Pre-commit scope check | `gitnexus_detect_changes({scope: "staged"})` |
| `rename` | Safe multi-file rename | `gitnexus_rename({symbol_name: "old", new_name: "new", dry_run: true})` |
| `cypher` | Custom graph queries | `gitnexus_cypher({query: "MATCH ..."})` |

## Impact Risk Levels

| Depth | Meaning | Action |
|-------|---------|--------|
| d=1 | WILL BREAK — direct callers/importers | MUST update these |
| d=2 | LIKELY AFFECTED — indirect deps | Should test |
| d=3 | MAY NEED TESTING — transitive | Test if critical path |

## Resources

| Resource | Use for |
|----------|---------|
| `gitnexus://repo/effect-packages/context` | Codebase overview, check index freshness |
| `gitnexus://repo/effect-packages/clusters` | All functional areas |
| `gitnexus://repo/effect-packages/processes` | All execution flows |
| `gitnexus://repo/effect-packages/process/{name}` | Step-by-step execution trace |

## Self-Check Before Finishing

Before completing any code modification task, verify:
1. `gitnexus_impact` was run for all modified symbols
2. No HIGH/CRITICAL risk warnings were ignored
3. `gitnexus_detect_changes()` confirms changes match expected scope
4. All d=1 (WILL BREAK) dependents were updated

## Keeping the Index Fresh

After committing code changes, the GitNexus index becomes stale. Re-run analyze to update it:

```bash
npx gitnexus analyze
```

If the index previously included embeddings, preserve them by adding `--embeddings`:

```bash
npx gitnexus analyze --embeddings
```

To check whether embeddings exist, inspect `.gitnexus/meta.json` — the `stats.embeddings` field shows the count (0 means no embeddings). **Running analyze without `--embeddings` will delete any previously generated embeddings.**

> Claude Code users: A PostToolUse hook handles this automatically after `git commit` and `git merge`.

## CLI

| Task | Read this skill file |
|------|---------------------|
| Understand architecture / "How does X work?" | `.claude/skills/gitnexus/gitnexus-exploring/SKILL.md` |
| Blast radius / "What breaks if I change X?" | `.claude/skills/gitnexus/gitnexus-impact-analysis/SKILL.md` |
| Trace bugs / "Why is X failing?" | `.claude/skills/gitnexus/gitnexus-debugging/SKILL.md` |
| Rename / extract / split / refactor | `.claude/skills/gitnexus/gitnexus-refactoring/SKILL.md` |
| Tools, resources, schema reference | `.claude/skills/gitnexus/gitnexus-guide/SKILL.md` |
| Index, status, clean, wiki CLI commands | `.claude/skills/gitnexus/gitnexus-cli/SKILL.md` |

<!-- gitnexus:end -->
