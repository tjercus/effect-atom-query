---
"@effect-atom-query/query": minor
---

Add `Mutation.optimisticUpdate(query, update)`: an `onMutate` / `onError` pair that writes an optimistic update to the cache and restores the snapshot on failure.
