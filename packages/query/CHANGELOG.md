# @effect-atom-query/query

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
