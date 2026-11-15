---
"@effect-atom-query/query": minor
---

Add `QueryKey.make(...elements)`, which builds a key typed as a tuple without `as const`: `QueryKey.make(...postKeys.all, "detail", id)` is `readonly ["posts", "detail", number]`. Key constants written as plain arrays widen to `string[]` and made `Query.make` / `invalidates` fail with "No overload matches this call"; `make` reports a widened array where the key is built instead.
