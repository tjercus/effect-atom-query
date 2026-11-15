---
"@effect-atom-query/react": minor
---

Add `useRunEffect()`, the library's one Promise boundary (decision D11). It returns a runner bound to the provider's client: `promiseExit(effect)` resolves with the `Exit` and never rejects, and `promise(effect)` resolves with the value or rejects with the typed error. Both accept `{ signal }`. Effects run with the services of the client's layer plus `QueryClient`; declare your app's services once by augmenting the `Register` interface. Each method infers the whole Effect, so `run.promiseExit(cond ? update.mutateEffect(x) : create.mutateEffect(x))` type-checks. The library itself stays Effect-only: no `mutateAsync` and no Promise-returning client methods.
