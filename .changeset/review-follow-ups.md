---
"@effect-atom-query/query": patch
"@effect-atom-query/react": minor
"@effect-atom-query/devtools": patch
---

- New `useQueryClientOption()` in the react package: the provider's client as an `Option`, `None` outside a provider. The devtools use it instead of catching the error of `useQueryClient`.
- Persisted data and mutation variables are stored as `JSON.stringify` writes them, whatever the schema. A value it cannot write (a bigint, a cycle) skips only that query or mutation, with one warning naming its key. An `undefined` field no longer keeps Standard Schema data from being persisted.
- `QueryClientProvider` with its own `registry`: unmounting while a query atom is still mounted elsewhere no longer raises an uncaught `MissingQueryClientError`, and a disposed registry is no longer recognised by its error message.
- A mutation state without the data or cause it should have is reported as a defect instead of being skipped or shown as a success.
- Labels of keys whose parts cannot be turned into a string no longer throw.
