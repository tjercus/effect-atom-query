---
"@effect-atom-query/react": patch
---

`useQuery`, `useSuspenseQuery`, `useInfiniteQuery` and `useSuspenseInfiniteQuery` infer their data type from the query and `select` only. Before, passing the result straight into another generic function (`adapt(useQuery(q))`) could make TypeScript infer the data type as `undefined`.
