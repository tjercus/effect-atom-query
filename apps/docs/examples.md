# Examples

The playground (`apps/playground`, `pnpm dev`) runs each example against a fake
backend `Api` service with realistic latency. Every example corresponds to a
TanStack Query React example:

| example                       | TanStack example                | shows                                                   |
| ----------------------------- | ------------------------------- | ------------------------------------------------------- |
| Simple                        | `simple`                        | one query backed by a service                           |
| Basic                         | `basic`                         | list and detail with a query family, background updates |
| Pagination                    | `pagination`                    | `Query.keepPreviousData`, `usePrefetchQuery`            |
| Load more & infinite scroll   | `load-more-infinite-scroll`     | bidirectional `useInfiniteQuery`, IntersectionObserver  |
| Infinite query with max pages | `infinite-query-with-max-pages` | `maxPages`                                              |
| Dependent queries             | dependent queries guide         | `Query.skipToken`                                       |
| Prefetching                   | `prefetching`                   | `client.prefetchQuery` on hover, run on the runtime     |
| Auto refetching / polling     | `auto-refetching`               | `refetchInterval` per component, invalidating mutations |
| Optimistic updates (UI)       | `optimistic-updates-ui`         | `Mutation.optimistic`                                   |
| Optimistic updates (cache)    | `optimistic-updates-cache`      | `onMutate` / `onError` / `onSettled` as Effects         |
| Suspense                      | `suspense`                      | `useSuspenseQuery`, `useSuspenseQueries`, error reset   |
| Offline & persistence         | `offline`                       | `QueryPersister`, paused and resumed mutations          |

Devtools are mounted on every page.
