---
"@ballatech/effect-oauth-client": patch
---

Tighten boolean-expression handling in `make` and `makeFromConfig`: empty-string credentials (`scope: ""`, `audience: ""`, `baseUrl: ""`) are now treated identically to `undefined` and omitted from the outgoing token request / base-URL rewrite. Previously the ternary `scope ? ... : undefined` happened to do the same thing via JS truthiness; the new check (`x !== undefined && x.length > 0`) makes the intent explicit and satisfies the Effect language service `strictBooleanExpressions` rule.
