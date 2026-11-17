---
"@effect-atom-query/query": patch
"@effect-atom-query/react": patch
"@effect-atom-query/devtools": patch
---

Fix persistence stopping on data that is not JSON, and stop hiding unexpected errors:

- A query persisted with a Standard Schema whose data is not JSON (a `bigint`, a `Date`, a class instance) is now skipped. Before, it made the whole snapshot fail to encode, which killed the persister's write and stopped all persisting.
- If the snapshot still cannot be encoded, the write is skipped with a warning instead of dying.
- `QueryClientProvider` no longer swallows errors thrown while unbinding the client, other than the expected "registry is disposed".
- The devtools only treat a missing `QueryClientProvider` as "no client"; other errors from `useQueryClient` are no longer hidden.
