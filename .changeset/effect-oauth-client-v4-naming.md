---
"@ballatech/effect-oauth-client": major
---

Align the public API with Effect v4 naming conventions.

- Add `OAuthHttpClient.layerConfig`. `layerFromConfig` remains as a deprecated alias.
- Breaking: `AuthorizationError` now has the `_tag` `"OAuthAuthorizationError"` (was `"@ballatech/effect-oauth-client/AuthorizationError"`). Update `Effect.catchTag` calls that match on the old string; `isAuthorizationError` is unaffected.
- Breaking (types only): `Credentials` fields are `readonly`.
- Every public export has `@since` and `@category` JSDoc. `package.json` is exported, and the package is published with provenance.
