# @effect-atom-query/query

## 1.1.0

### Minor Changes

- cc42bf4: Add `Mutation.optimisticUpdate(query, update)`: `onMutate` / `onError` / `onSettled` callbacks that write an optimistic update to the cache, restore the snapshot on failure, and refetch the query once the mutation settles.
- 14869a4: Public result constructors for mocking hooks in tests: `QueryResult.pending()`, `QueryResult.success(data)`, `QueryResult.failure(error)`, and `MutationResult.idle()`, `.pending(input)`, `.success(data, input)`, `.failure(error, input)`.
- 3fb86ff: Per-call and `useMutation` `onError` callbacks receive the typed failure as a third argument (`Option<E>`, `None` for defects).

## 1.0.0

### Major Changes

- 3cafd77: initial release
