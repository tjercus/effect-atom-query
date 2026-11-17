---
"@effect-atom-query/react": patch
---

`queryHookResult` and `mutationHookResult` accept `undefined` for an override (with `exactOptionalPropertyTypes`) and then keep the default no-op, instead of copying `undefined` over it.
