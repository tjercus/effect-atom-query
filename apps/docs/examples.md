# Examples

The [playground](https://github.com/tjercus/effect-atom-query/tree/main/apps/playground)
runs each example against a fake backend
[`Api` service](https://github.com/tjercus/effect-atom-query/blob/main/apps/playground/src/api.ts)
with realistic latency. Clone the repository and start it with `vp run dev`. Every example corresponds to a
TanStack Query React example; the name links to its source:

| example                                                                                                                               | TanStack example                | shows                                                   |
| ------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------- | ------------------------------------------------------- |
| [Simple](https://github.com/tjercus/effect-atom-query/blob/main/apps/playground/src/examples/Simple.tsx)                              | `simple`                        | one query backed by a service                           |
| [Basic](https://github.com/tjercus/effect-atom-query/blob/main/apps/playground/src/examples/Basic.tsx)                                | `basic`                         | list and detail with a query family, background updates |
| [Pagination](https://github.com/tjercus/effect-atom-query/blob/main/apps/playground/src/examples/Pagination.tsx)                      | `pagination`                    | `Query.keepPreviousData`, `usePrefetchQuery`            |
| [Load more & infinite scroll](https://github.com/tjercus/effect-atom-query/blob/main/apps/playground/src/examples/InfiniteScroll.tsx) | `load-more-infinite-scroll`     | bidirectional `useInfiniteQuery`, IntersectionObserver  |
| [Infinite query with max pages](https://github.com/tjercus/effect-atom-query/blob/main/apps/playground/src/examples/MaxPages.tsx)     | `infinite-query-with-max-pages` | `maxPages`                                              |
| [Dependent queries](https://github.com/tjercus/effect-atom-query/blob/main/apps/playground/src/examples/Dependent.tsx)                | dependent queries guide         | `Query.skipToken`                                       |
| [Prefetching](https://github.com/tjercus/effect-atom-query/blob/main/apps/playground/src/examples/Prefetching.tsx)                    | `prefetching`                   | `client.prefetchQuery` on hover, run on the runtime     |
| [Auto refetching / polling](https://github.com/tjercus/effect-atom-query/blob/main/apps/playground/src/examples/AutoRefetching.tsx)   | `auto-refetching`               | `refetchInterval` per component, invalidating mutations |
| [Optimistic updates (UI)](https://github.com/tjercus/effect-atom-query/blob/main/apps/playground/src/examples/OptimisticUi.tsx)       | `optimistic-updates-ui`         | `Mutation.optimistic`                                   |
| [Optimistic updates (cache)](https://github.com/tjercus/effect-atom-query/blob/main/apps/playground/src/examples/OptimisticCache.tsx) | `optimistic-updates-cache`      | `onMutate` / `onError` / `onSettled` as Effects         |
| [Suspense](https://github.com/tjercus/effect-atom-query/blob/main/apps/playground/src/examples/Suspense.tsx)                          | `suspense`                      | `useSuspenseQuery`, `useSuspenseQueries`, error reset   |
| [Offline & persistence](https://github.com/tjercus/effect-atom-query/blob/main/apps/playground/src/examples/Offline.tsx)              | `offline`                       | `QueryPersister`, paused and resumed mutations          |

Devtools are mounted on every page.
