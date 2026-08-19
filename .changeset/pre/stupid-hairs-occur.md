---
"@ballatech/effect-oauth-client": patch
"effect-lambda": patch
---

Drop CommonJS output and replace tsup bundler with plain tsc compilation. Packages now emit ESM-only output with source maps and declaration maps. Source `.ts` files are included in the published package for better IDE experience.
