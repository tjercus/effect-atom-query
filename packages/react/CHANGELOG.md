# @effect-atom-query/react

## 1.4.0-next.2

### Minor Changes

- e3785cb: Request options without a new query key. `Query.FetchAttempt` tells a query's `run` which attempt is running (`0`, then `1`, `2`, … on retries), for example to bypass an HTTP cache when retrying. `refetchQueries`, `invalidateQueries` and `resetQueries` now run the fetches they start with the caller's services, as `fetchQuery` already did, so request options can be provided as services (`Effect.provideService`) while the cache entry stays the same. A mutation's `invalidates` refetches with the services of its `mutate` call.

### Patch Changes

- 9b117f4: Docs: the `refetch` JSDoc explains how to wait for a refetch. The guides gain "Waiting for a refetch", "Request options without a new key", and a getting-started guide that covers loading, typed failures, failures with old data, empty results, retry, a shared registry and testing with `makeTestHarness`.
- Updated dependencies [e3785cb]
  - @effect-atom-query/query@1.4.0-next.2

## 1.4.0-next.1

### Patch Changes

- Docs: the README example matches on query outcomes with `QueryResult.match` instead of checking `isPending` / `isError` / `isSuccess` with `if`s.
- @effect-atom-query/query@1.4.0-next.1

## 1.4.0-next.0

### Minor Changes

- d4b523d: - New `useQueryClientOption()` in the react package: the provider's client as an `Option`, `None` outside a provider. The devtools use it instead of catching the error of `useQueryClient`.
  - Persisted data and mutation variables are stored as `JSON.stringify` writes them, whatever the schema. A value it cannot write (a bigint, a cycle) skips only that query or mutation, with one warning naming its key. An `undefined` field no longer keeps Standard Schema data from being persisted.
  - `QueryClientProvider` with its own `registry`: unmounting while a query atom is still mounted elsewhere no longer raises an uncaught `MissingQueryClientError`, and a disposed registry is no longer recognised by its error message.
  - A mutation state without the data or cause it should have is reported as a defect instead of being skipped or shown as a success.
  - Labels of keys whose parts cannot be turned into a string no longer throw.

### Patch Changes

- b282614: Internal: Effect functions use `Effect.fnUntraced`, resuming paused mutations after a restore uses `Effect.forkDetach`, and `useRunEffect` runs Effects through the client's `runPromiseExit` instead of a hand-built Promise. No behavior change.
- 30c8c63: Keys JSON cannot hold no longer throw outside persistence:

  - `Mutation.make` with such a key no longer throws while building its label.
  - The "has no `run`" defect messages no longer throw while formatting the key.
  - Persisted storage that cannot be read now logs a warning instead of being ignored silently.
  - The devtools "ago" labels use the client's clock, so they agree with the snapshot times under a `TestClock`.

- 027d933: Fix persistence stopping on data that is not JSON, and stop hiding unexpected errors:

  - A query whose persisted data JSON cannot hold (a `bigint`, a cycle) is now skipped. Before, it made the whole snapshot fail to encode, which killed the persister's write and stopped all persisting.
  - `QueryClientProvider` no longer swallows errors thrown while unbinding the client, other than the ones unbinding is expected to cause.
  - The devtools only treat a missing `QueryClientProvider` as "no client".

- 243c860: `queryHookResult` and `mutationHookResult` accept `undefined` for an override (with `exactOptionalPropertyTypes`) and then keep the default no-op, instead of copying `undefined` over it.
- Updated dependencies [b282614]
- Updated dependencies [7122f2f]
- Updated dependencies [30c8c63]
- Updated dependencies [027d933]
- Updated dependencies [d4b523d]
- Updated dependencies [eb50a97]
  - @effect-atom-query/query@1.4.0-next.0

## 1.3.1

### Patch Changes

- Updated dependencies [e80ede1]
- Updated dependencies [809b97e]
  - @effect-atom-query/query@1.3.1

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
