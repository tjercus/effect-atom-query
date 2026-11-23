# @effect-atom-query/query

## 1.4.0

### Minor Changes

- f051723: Raise the minimum supported Effect and @effect/atom-react versions to 4.1.5.
- e3785cb: Request options without a new query key. `Query.FetchAttempt` tells a query's `run` which attempt is running (`0`, then `1`, `2`, … on retries), for example to bypass an HTTP cache when retrying. `refetchQueries`, `invalidateQueries` and `resetQueries` now run the fetches they start with the caller's services, as `fetchQuery` already did, so request options can be provided as services (`Effect.provideService`) while the cache entry stays the same. A mutation's `invalidates` refetches with the services of its `mutate` call.

### Patch Changes

- b282614: Internal: Effect functions use `Effect.fnUntraced`, resuming paused mutations after a restore uses `Effect.forkDetach`, and `useRunEffect` runs Effects through the client's `runPromiseExit` instead of a hand-built Promise. No behavior change.
- 7122f2f: Internal: persisted infinite query data is checked with a `Schema` instead of by hand. No behavior change.
- 30c8c63: Keys JSON cannot hold no longer throw outside persistence:

  - `Mutation.make` with such a key no longer throws while building its label.
  - The "has no `run`" defect messages no longer throw while formatting the key.
  - Persisted storage that cannot be read now logs a warning instead of being ignored silently.
  - The devtools "ago" labels use the client's clock, so they agree with the snapshot times under a `TestClock`.

- 027d933: Fix persistence stopping on data that is not JSON, and stop hiding unexpected errors:

  - A query whose persisted data JSON cannot hold (a `bigint`, a cycle) is now skipped. Before, it made the whole snapshot fail to encode, which killed the persister's write and stopped all persisting.
  - `QueryClientProvider` no longer swallows errors thrown while unbinding the client, other than the ones unbinding is expected to cause.
  - The devtools only treat a missing `QueryClientProvider` as "no client".

- d4b523d: - New `useQueryClientOption()` in the react package: the provider's client as an `Option`, `None` outside a provider. The devtools use it instead of catching the error of `useQueryClient`.
  - Persisted data and mutation variables are stored as `JSON.stringify` writes them, whatever the schema. A value it cannot write (a bigint, a cycle) skips only that query or mutation, with one warning naming its key. An `undefined` field no longer keeps Standard Schema data from being persisted.
  - `QueryClientProvider` with its own `registry`: unmounting while a query atom is still mounted elsewhere no longer raises an uncaught `MissingQueryClientError`, and a disposed registry is no longer recognised by its error message.
  - A mutation state without the data or cause it should have is reported as a defect instead of being skipped or shown as a success.
  - Labels of keys whose parts cannot be turned into a string no longer throw.
- eb50a97: Persistence no longer crashes or silently hides bugs on data it cannot store:

  - A persisted query whose key JSON cannot hold (a cycle, a throwing `toJSON`) no longer throws when its atom is mounted; it is simply not persisted.
  - A persist schema whose transform or validator throws is now reported once with `console.warn`; the value is still skipped. Data the schema rejects is skipped without a warning, as before.

## 1.4.0-next.3

### Minor Changes

- f051723: Raise the minimum supported Effect and @effect/atom-react versions to 4.1.5.

## 1.4.0-next.2

### Minor Changes

- e3785cb: Request options without a new query key. `Query.FetchAttempt` tells a query's `run` which attempt is running (`0`, then `1`, `2`, … on retries), for example to bypass an HTTP cache when retrying. `refetchQueries`, `invalidateQueries` and `resetQueries` now run the fetches they start with the caller's services, as `fetchQuery` already did, so request options can be provided as services (`Effect.provideService`) while the cache entry stays the same. A mutation's `invalidates` refetches with the services of its `mutate` call.

## 1.4.0-next.1

No changes in this release.

## 1.4.0-next.0

### Patch Changes

- b282614: Internal: Effect functions use `Effect.fnUntraced`, resuming paused mutations after a restore uses `Effect.forkDetach`, and `useRunEffect` runs Effects through the client's `runPromiseExit` instead of a hand-built Promise. No behavior change.
- 7122f2f: Internal: persisted infinite query data is checked with a `Schema` instead of by hand. No behavior change.
- 30c8c63: Keys JSON cannot hold no longer throw outside persistence:

  - `Mutation.make` with such a key no longer throws while building its label.
  - The "has no `run`" defect messages no longer throw while formatting the key.
  - Persisted storage that cannot be read now logs a warning instead of being ignored silently.
  - The devtools "ago" labels use the client's clock, so they agree with the snapshot times under a `TestClock`.

- 027d933: Fix persistence stopping on data that is not JSON, and stop hiding unexpected errors:

  - A query whose persisted data JSON cannot hold (a `bigint`, a cycle) is now skipped. Before, it made the whole snapshot fail to encode, which killed the persister's write and stopped all persisting.
  - `QueryClientProvider` no longer swallows errors thrown while unbinding the client, other than the ones unbinding is expected to cause.
  - The devtools only treat a missing `QueryClientProvider` as "no client".

- d4b523d: - New `useQueryClientOption()` in the react package: the provider's client as an `Option`, `None` outside a provider. The devtools use it instead of catching the error of `useQueryClient`.
  - Persisted data and mutation variables are stored as `JSON.stringify` writes them, whatever the schema. A value it cannot write (a bigint, a cycle) skips only that query or mutation, with one warning naming its key. An `undefined` field no longer keeps Standard Schema data from being persisted.
  - `QueryClientProvider` with its own `registry`: unmounting while a query atom is still mounted elsewhere no longer raises an uncaught `MissingQueryClientError`, and a disposed registry is no longer recognised by its error message.
  - A mutation state without the data or cause it should have is reported as a defect instead of being skipped or shown as a success.
  - Labels of keys whose parts cannot be turned into a string no longer throw.
- eb50a97: Persistence no longer crashes or silently hides bugs on data it cannot store:

  - A persisted query whose key JSON cannot hold (a cycle, a throwing `toJSON`) no longer throws when its atom is mounted; it is simply not persisted.
  - A persist schema whose transform or validator throws is now reported once with `console.warn`; the value is still skipped. Data the schema rejects is skipped without a warning, as before.

## 1.3.1

### Patch Changes

- e80ede1: Fix six edge cases:

  - `resetQueries` reloads an observed query with `staleTime: "static"` instead of leaving it pending.
  - Restored (persisted) data replaces a query's `initialData`, whether it is restored before or after the query is first used.
  - Refreshing a query atom (`registry.refresh`, `useAtomRefresh`) refetches with the client of that registry when the atom is mounted in several registries.
  - A `staleTime` passed to `useQuery` (or a `QueryObserver`) notifies when it passes, so `isStale` re-renders on time.
  - An unobserved cache entry is garbage collected after `resetQueries` drops its running fetch, and polling continues after a reset.
  - `QueryKey.toJsonKey` keeps `undefined` values, so `["todos", { page: undefined }]` and `["todos", {}]`, which are separate cache entries, no longer share one storage key. Persisted data stored for keys containing `undefined` is not restored once and is fetched again.

- 809b97e: Fix three lifecycle defects:

  - `client.clear` no longer interrupts running mutations, so it is safe to call from a mutation's own callback (a logout mutation, say): the mutation finishes, its callbacks run, and `useMutation` sees it settle. Closing the client still interrupts running mutations.
  - `fetchQuery`, `prefetchQuery` and `ensureQueryData` follow the fetch that superseded the one they were waiting for (an `invalidateQueries` elsewhere), instead of failing with an interrupt. `cancelQueries` and `removeQueries` still interrupt the caller.
  - An interrupted mutation goes back to `idle`. It is no longer reported as an error or defect, thrown to the error boundary, or passed to the `useMutation` callbacks.

## 1.3.0

### Minor Changes

- aab5f8a: Persistence accepts Standard Schema validators (zod, Valibot, ArkType) as well as Effect Schemas: `persist: { schema }` on queries, `persist: { page, pageParam }` on infinite queries and `persist: { variables }` on mutations. Data persisted with a Standard Schema is stored as is (so it must be JSON-compatible) and validated when restored; invalid data is dropped and refetched. Validators must be synchronous: an async validator's data is not restored, and a warning is logged once. An Effect Schema that also carries `~standard` keeps using its JSON codec. New types: `Query.StandardSchema<A>` and `Query.PersistSchema<A>`.
- 9abcd08: Add `QueryKey.make(...elements)`, which builds a key typed as a tuple without `as const`: `QueryKey.make(...postKeys.all, "detail", id)` is `readonly ["posts", "detail", number]`. Key constants written as plain arrays widen to `string[]` and made `Query.make` / `invalidates` fail with "No overload matches this call"; `make` reports a widened array where the key is built instead.
- 133c176: Test utilities. In the core, `QueryResult.idle()` builds what a query disabled with `enabled: false` returns, and `QueryResult.disabled()` no longer needs an argument. A new entry point, `@effect-atom-query/react/testing`, adds `makeTestHarness` (a client with test defaults, your fake services, a registry and a `Wrapper` provider, plus `run` and `dispose`), `controlled()` (a fake response that stays pending until the test completes it), `queryHookResult` / `mutationHookResult` (hook results for mocks, without casts) and `testQueryClientLayer` / `testDefaultOptions` (no retries, no focus or reconnect refetches, no gc timers). The main entry point and its size are unchanged.

### Patch Changes

- df371c0: Closing the client no longer refetches query atoms that are still mounted in a registry (`registry.mount`, `useAtomValue`, code outside React). When the client shut down, each such atom rebuilt itself against the closing cache and started one more fetch. Mounted atoms now keep their last result, and a query atom first read after shutdown returns a disabled result without fetching. The `use*Query` hooks were not affected.
- fc77678: Documentation: `staleTime: "static"` is skipped by invalidation (use `"Infinity"` for "cached until invalidated"), `QueryClientProvider` provides the atom `RegistryContext`, and `mutateEffect` updates the hook's state like `mutate`. New guides: "Coming from Redux / RTK Query", plus sections on key constants, errors and structural sharing.

## 1.2.0

First npm release of the 1.1.0 changes: 1.1.0 was tagged on GitHub but never published to npm. There are no code changes since 1.1.0; see the 1.1.0 entry below for what's new since 1.0.0.

## 1.1.0

### Minor Changes

- cc42bf4: Add `Mutation.optimisticUpdate(query, update)`: `onMutate` / `onError` / `onSettled` callbacks that write an optimistic update to the cache, restore the snapshot on failure, and refetch the query once the mutation settles.
- 14869a4: Public result constructors for mocking hooks in tests: `QueryResult.pending()`, `QueryResult.success(data)`, `QueryResult.failure(error)`, and `MutationResult.idle()`, `.pending(input)`, `.success(data, input)`, `.failure(error, input)`.
- 3fb86ff: Per-call and `useMutation` `onError` callbacks receive the typed failure as a third argument (`Option<E>`, `None` for defects).

## 1.0.0

### Major Changes

- 3cafd77: initial release
