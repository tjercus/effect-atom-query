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

## Flight dashboard

The [flight dashboard](https://github.com/tjercus/effect-atom-query/tree/main/apps/flight-dashboard)
is one app that shows what goes beyond TanStack Query. Start it with `vp run dev:flights`.

| what to look at                                                                                                        | shows                                                                                                                          |
| ---------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| [backend layers](https://github.com/tjercus/effect-atom-query/blob/main/apps/flight-dashboard/src/api/layers.ts)       | the `FlightApi` service as HTTP, in-memory and chaos layers, swapped at runtime without touching a component                   |
| [typed errors](https://github.com/tjercus/effect-atom-query/blob/main/apps/flight-dashboard/src/components/status.tsx) | an exhaustive `switch` over the error union; defects go to a per-panel error boundary                                          |
| [retry schedule](https://github.com/tjercus/effect-atom-query/blob/main/apps/flight-dashboard/src/queries.ts)          | `retry` as a `Schedule`: backoff with jitter, `retryAfterMs`, no retry for permanent errors, polling that stops on them        |
| [search](https://github.com/tjercus/effect-atom-query/blob/main/apps/flight-dashboard/src/components/FlightSearch.tsx) | `cancelQueries` interrupts the superseded search's fiber, which aborts its `fetch`                                             |
| [tests](https://github.com/tjercus/effect-atom-query/tree/main/apps/flight-dashboard/test)                             | the same layers in tests: the schedule with `TestClock`, the layers with forced outcomes, components through `makeTestHarness` |
