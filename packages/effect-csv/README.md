# effect-csv

> [!NOTE]
> **Not published yet.** This package is a skeleton and stays `private` until its first release. See [PLAN.md](./PLAN.md) for the design and roadmap.

Streaming CSV parsing and writing for [Effect v4](https://github.com/Effect-TS/effect), with `Schema`-typed rows and no runtime dependencies. It is meant to run on Node, Bun, Deno, browsers and edge runtimes: it relies only on `TextDecoder` and `TextEncoder`, never on `Buffer` or `node:*` modules.

## Installation (once published)

```bash
pnpm add effect-csv effect
```

> This package expects `effect` v4 as a peer.
