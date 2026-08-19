# @ballatech/effect-oauth-client

## 1.0.0-beta.8

### Patch Changes

- [`a91b9bd`](https://github.com/successkrisz/effect-packages/commit/a91b9bd17ab94937103622e30d6fb9c8053730e7) Thanks [@successkrisz](https://github.com/successkrisz)! - chore: fix release pipeline

## 1.0.0-beta.7

### Major Changes

- Update to work with effect beta.49

- Support Effect v4

### Minor Changes

- Add `baseUrl` option, `makeFromConfig` constructor, `layer`/`layerFromConfig` helpers, `OAuthHttpClient` service tag, and `Client` type alias.

- Rename module export from `OAuthClient` to `OAuthHttpClient` to better communicate that this package provides an OAuth-authenticated HttpClient, not a generic OAuth client. The source file is also renamed to `OAuthHttpClient.ts` to align with Effect v4's convention of matching file names to their primary export. This is a breaking change — update imports from `{ OAuthClient }` to `{ OAuthHttpClient }`.

- Retry on 401 and transient token endpoint failures
  
  - Downstream 401 responses now invalidate the cached token and retry the request once with a fresh token. If the retry also returns 401, the error propagates as `AuthorizationError` with code `unauthorized`.
  - Token endpoint transient errors (429 rate limiting, 5xx server errors, network failures) are now retried up to 2 times with exponential backoff (200ms, 400ms). Permanent errors (4xx bad credentials/scope) still fail immediately.
  - Error classification now uses `Schema.isSchemaError` instead of a brittle `_tag` string check.

### Patch Changes

- Tighten boolean-expression handling in `make` and `makeFromConfig`: empty-string credentials (`scope: ""`, `audience: ""`, `baseUrl: ""`) are now treated identically to `undefined` and omitted from the outgoing token request / base-URL rewrite. Previously the ternary `scope ? ... : undefined` happened to do the same thing via JS truthiness; the new check (`x !== undefined && x.length > 0`) makes the intent explicit and satisfies the Effect language service `strictBooleanExpressions` rule.

- Drop CommonJS output and replace tsup bundler with plain tsc compilation. Packages now emit ESM-only output with source maps and declaration maps. Source `.ts` files are included in the published package for better IDE experience.

- [#30](https://github.com/successkrisz/effect-packages/pull/30) [`a91b9bd`](https://github.com/successkrisz/effect-packages/commit/a91b9bd17ab94937103622e30d6fb9c8053730e7) Thanks [@github-actions](https://github.com/apps/github-actions)! - update dev deps to effect@rc

- effect@4.0.0-beta.83 support

- Preserve the original error on AuthorizationError as cause

## 1.0.0-beta.6

### Patch Changes

- [`a91b9bd`](https://github.com/successkrisz/effect-packages/commit/a91b9bd17ab94937103622e30d6fb9c8053730e7) Thanks [@successkrisz](https://github.com/successkrisz)! - effect@4.0.0-beta.83 support

## 1.0.0-beta.5

### Major Changes

- [`0347319`](https://github.com/successkrisz/effect-packages/commit/0347319102d29b7b6eece5ef80cf68ffeb976363) - Update to work with effect beta.49

## 1.0.0-beta.4

### Minor Changes

- [#21](https://github.com/successkrisz/effect-packages/pull/21) [`74bf3e0`](https://github.com/successkrisz/effect-packages/commit/74bf3e001d982f15421fdbc9c57456cac1ef3c17) Thanks [@github-actions](https://github.com/apps/github-actions)! - Rename module export from `OAuthClient` to `OAuthHttpClient` to better communicate that this package provides an OAuth-authenticated HttpClient, not a generic OAuth client. The source file is also renamed to `OAuthHttpClient.ts` to align with Effect v4's convention of matching file names to their primary export. This is a breaking change — update imports from `{ OAuthClient }` to `{ OAuthHttpClient }`.

## 1.0.0-beta.3

### Patch Changes

- [#20](https://github.com/successkrisz/effect-packages/pull/20) [`ded75cc`](https://github.com/successkrisz/effect-packages/commit/ded75cc22292d94558955c39a83e23220ad8c330) Thanks [@github-actions](https://github.com/apps/github-actions)! - Drop CommonJS output and replace tsup bundler with plain tsc compilation. Packages now emit ESM-only output with source maps and declaration maps. Source `.ts` files are included in the published package for better IDE experience.

- [`e924877`](https://github.com/successkrisz/effect-packages/commit/e9248771a5dd59edfbaf413315fde32951363c6d) - Preserve the original error on AuthorizationError as cause

## 1.0.0-beta.2

### Minor Changes

- [`ce84710`](https://github.com/successkrisz/effect-packages/commit/ce84710cb82a75e004e1c2b4bb86842141512580) - Retry on 401 and transient token endpoint failures

  - Downstream 401 responses now invalidate the cached token and retry the request once with a fresh token. If the retry also returns 401, the error propagates as `AuthorizationError` with code `unauthorized`.
  - Token endpoint transient errors (429 rate limiting, 5xx server errors, network failures) are now retried up to 2 times with exponential backoff (200ms, 400ms). Permanent errors (4xx bad credentials/scope) still fail immediately.
  - Error classification now uses `Schema.isSchemaError` instead of a brittle `_tag` string check.

## 1.0.0-beta.1

### Minor Changes

- [`4bb46a4`](https://github.com/successkrisz/effect-packages/commit/4bb46a454394753d503c681764c5e9e86b27c0aa) - Add `baseUrl` option, `makeFromConfig` constructor, `layer`/`layerFromConfig` helpers, `OAuthHttpClient` service tag, and `Client` type alias.

## 1.0.0-beta.0

### Major Changes

- [`1de2850`](https://github.com/successkrisz/effect-packages/commit/1de2850126fc0be581254d486c685e9b2fc66778) - Support Effect v4

## 0.3.2

### Patch Changes

- [`33a575e`](https://github.com/successkrisz/effect-packages/commit/33a575e3c6ba944439d47414602ffeec2531c54e) Thanks [@successkrisz](https://github.com/successkrisz)! - fix: don't pass in scope or audience as empty string when not provided

## 0.3.1

### Patch Changes

- [`044f2c3`](https://github.com/successkrisz/effect-packages/commit/044f2c3b306bed73fde68838a7afabac814c2f09) Thanks [@successkrisz](https://github.com/successkrisz)! - chore: use reusable tsconfig and biome settings

## 0.3.0

### Minor Changes

- [`4aaf96e`](https://github.com/successkrisz/effect-packages/commit/4aaf96ea20a6d3e9d443cf980975f24b43d0fc36) Thanks [@successkrisz](https://github.com/successkrisz)! - chore: add cjs exports and remove ts namespace

## 0.2.1

### Patch Changes

- [`72b632c`](https://github.com/successkrisz/effect-packages/commit/72b632ce5b9463a72a287887cf68ce5916b1ffd9) Thanks [@successkrisz](https://github.com/successkrisz)! - docs: update jsdocs

## 0.2.0

### Minor Changes

- [`91017e3`](https://github.com/successkrisz/effect-packages/commit/91017e342af8941058af51d7f9428d53760ca5be) Thanks [@successkrisz](https://github.com/successkrisz)! - feat: add expiry buffer to refresh token early, remove retry

## 0.1.1

### Patch Changes

- [`0bfb747`](https://github.com/successkrisz/effect-packages/commit/0bfb747c38176767f89e2c41e77a0d2e15d82809) Thanks [@successkrisz](https://github.com/successkrisz)! - docs: add repo links to package.json
