---
"@effect-atom-query/query": minor
---

Persistence accepts Standard Schema validators (zod, Valibot, ArkType) as well as Effect Schemas: `persist: { schema }` on queries, `persist: { page, pageParam }` on infinite queries and `persist: { variables }` on mutations. Data persisted with a Standard Schema is stored as is (so it must be JSON-compatible) and validated when restored; invalid data is dropped and refetched. Validators must be synchronous: an async validator's data is not restored, and a warning is logged once. An Effect Schema that also carries `~standard` keeps using its JSON codec. New types: `Query.StandardSchema<A>` and `Query.PersistSchema<A>`.
