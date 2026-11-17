---
"@effect-atom-query/query": patch
"@effect-atom-query/react": patch
"@effect-atom-query/devtools": patch
---

Fix persistence stopping on data that is not JSON, and stop hiding unexpected errors:

- A query whose persisted data JSON cannot hold (a `bigint`, a cycle) is now skipped. Before, it made the whole snapshot fail to encode, which killed the persister's write and stopped all persisting.
- `QueryClientProvider` no longer swallows errors thrown while unbinding the client, other than the ones unbinding is expected to cause.
- The devtools only treat a missing `QueryClientProvider` as "no client".
