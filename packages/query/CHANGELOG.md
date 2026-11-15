# @effect-atom-query/query

## 1.2.1

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
