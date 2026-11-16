---
"@effect-atom-query/query": patch
---

Fix six edge cases:

- `resetQueries` reloads an observed query with `staleTime: "static"` instead of leaving it pending.
- Restored (persisted) data replaces a query's `initialData`, whether it is restored before or after the query is first used.
- Refreshing a query atom (`registry.refresh`, `useAtomRefresh`) refetches with the client of that registry when the atom is mounted in several registries.
- A `staleTime` passed to `useQuery` (or a `QueryObserver`) notifies when it passes, so `isStale` re-renders on time.
- An unobserved cache entry is garbage collected after `resetQueries` drops its running fetch, and polling continues after a reset.
- `QueryKey.toJsonKey` keeps `undefined` values, so `["todos", { page: undefined }]` and `["todos", {}]`, which are separate cache entries, no longer share one storage key. Persisted data stored for keys containing `undefined` is not restored once and is fetched again.
