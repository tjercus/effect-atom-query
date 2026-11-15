# @effect-atom-query/react

## 1.3.0

### Minor Changes

- 133c176: Test utilities. In the core, `QueryResult.idle()` builds what a query disabled with `enabled: false` returns, and `QueryResult.disabled()` no longer needs an argument. A new entry point, `@effect-atom-query/react/testing`, adds `makeTestHarness` (a client with test defaults, your fake services, a registry and a `Wrapper` provider, plus `run` and `dispose`), `controlled()` (a fake response that stays pending until the test completes it), `queryHookResult` / `mutationHookResult` (hook results for mocks, without casts) and `testQueryClientLayer` / `testDefaultOptions` (no retries, no focus or reconnect refetches, no gc timers). The main entry point and its size are unchanged.
- 6a57f70: Add `useRunEffect()`, the library's one Promise boundary (decision D11). It returns a runner bound to the provider's client: `promiseExit(effect)` resolves with the `Exit` and never rejects, and `promise(effect)` resolves with the value or rejects with the typed error. Both accept `{ signal }`. Effects run with the services of the client's layer plus `QueryClient`; declare your app's services once by augmenting the `Register` interface. Each method infers the whole Effect, so `run.promiseExit(cond ? update.mutateEffect(x) : create.mutateEffect(x))` type-checks. The library itself stays Effect-only: no `mutateAsync` and no Promise-returning client methods.

### Patch Changes

- fc77678: `useQuery`, `useSuspenseQuery`, `useInfiniteQuery` and `useSuspenseInfiniteQuery` infer their data type from the query and `select` only. Before, passing the result straight into another generic function (`adapt(useQuery(q))`) could make TypeScript infer the data type as `undefined`.
- fc77678: `QueryClientProvider` no longer throws `registry is disposed` as an uncaught error when an app-supplied `registry` is disposed before the provider's deferred unbind runs. This happened in every component test that disposed its registry in `afterEach`, because Vitest runs `afterEach` before React Testing Library unmounts the tree.
- fc77678: Documentation: `staleTime: "static"` is skipped by invalidation (use `"Infinity"` for "cached until invalidated"), `QueryClientProvider` provides the atom `RegistryContext`, and `mutateEffect` updates the hook's state like `mutate`. New guides: "Coming from Redux / RTK Query", plus sections on key constants, errors and structural sharing.
- Updated dependencies [fc77678]
- Updated dependencies [aab5f8a]
- Updated dependencies [9abcd08]
- Updated dependencies [df371c0]
- Updated dependencies [133c176]
  - @effect-atom-query/query@1.3.0

## 1.2.0

First npm release of the 1.1.0 changes: 1.1.0 was tagged on GitHub but never published to npm. There are no code changes since 1.1.0; see the 1.1.0 entry below for what's new since 1.0.0.

### Patch Changes

- Updated dependencies
  - @effect-atom-query/query@1.2.0

## 1.1.0

### Minor Changes

- 7b266dd: `QueryClientProvider` accepts a `registry` prop: it binds the client into an existing `AtomRegistry` and provides it to hooks, instead of creating a fresh one. This lets React, plain code and query atoms share one app-wide registry.

### Patch Changes

- 7157758: Accept React 19.0 and later as a peer dependency (was `^19.3.1`). CI now also runs the React bindings and devtools tests against React 19.0.0.
- Updated dependencies [cc42bf4]
- Updated dependencies [14869a4]
- Updated dependencies [3fb86ff]
  - @effect-atom-query/query@1.1.0

## 1.0.0

### Major Changes

- 3cafd77: initial release

### Patch Changes

- Updated dependencies [3cafd77]
  - @effect-atom-query/query@1.0.0
