# TanStack Query → effect-atom-query feature matrix

✅ marks implemented features (phases 1–6, 2026-11-13; v1 scope complete).

Source: TanStack Query v5 React docs (important defaults, `useQuery`,
`useMutation`, `QueryClient`, network mode). The **Phase** column refers to
[PLAN.md §5](./PLAN.md#5-milestones).

## Important defaults

| TanStack default                       | Value                                       | Effect-native equivalent                                                                | Phase |
| -------------------------------------- | ------------------------------------------- | --------------------------------------------------------------------------------------- | ----- |
| ✅ `staleTime`                         | `0` (also `Infinity`, `'static'`)           | `Duration` (`Duration.zero` default), `Duration.infinity`, `"static"`                   | 1     |
| ✅ `gcTime`                            | 5 min (`Infinity` on server)                | `Atom.setIdleTTL(Duration.minutes(5))`                                                  | 1     |
| ✅ `retry`                             | 3 (client), 0 (server)                      | `Schedule.recurs(3)`                                                                    | 1     |
| ✅ `retryDelay`                        | `min(1000·2^n, 30s)`                        | `Schedule.exponential("1 second").pipe(Schedule.either(Schedule.spaced("30 seconds")))` | 1     |
| ✅ `retryOnMount`                      | `true`                                      | same flag                                                                               | 3     |
| ✅ `refetchOnMount`                    | `true` (`"always"`)                         | same values                                                                             | 1     |
| ✅ `refetchOnWindowFocus`              | `true` (`"always"`)                         | FocusManager signal (`Atom.windowFocusSignal`)                                          | 3     |
| ✅ `refetchOnReconnect`                | `true` (`false` if `networkMode: 'always'`) | OnlineManager signal                                                                    | 3     |
| ✅ `refetchInterval` / `…InBackground` | `false` / `false`                           | `Duration` or `Schedule`                                                                | 3     |
| ✅ `structuralSharing`                 | `true`                                      | `Equal` check + `replaceEqualDeep`                                                      | 2     |
| ✅ `throwOnError`                      | `false`                                     | `false`; defects are always thrown                                                      | 2     |
| ✅ `networkMode`                       | `'online'`                                  | `'online' \| 'always' \| 'offlineFirst'` using a `Latch`                                | 3     |
| ✅ `enabled` / `skipToken`             | `true`                                      | boolean, `(get) => boolean`, or `skipToken`                                             | 1     |
| ✅ `notifyOnChangeProps`               | tracked                                     | tracked via a result Proxy (also `"all"` or a list); option-aware comparison            | 7     |
| ✅ Mutation `retry`                    | 0                                           | `Schedule` (none by default)                                                            | 4     |

## Query options

| Option                                    | Plan                                                          |
| ----------------------------------------- | ------------------------------------------------------------- |
| `queryKey` / `queryFn`                    | `key` + `run: (arg) => Effect<A, E, R>`                       |
| ✅ `select`                               | per-observer (`QueryObserver`), memoised, structurally shared |
| ✅ `placeholderData` / `keepPreviousData` | per-observer; value or `(previous: Option<A>) => Option<A>`   |
| ✅ `initialData` / `initialDataUpdatedAt` | seeds the cache entry; `data` typed non-optional              |
| `meta`                                    | `meta: Record<string, unknown>` passed to cache callbacks     |
| `queryKeyHashFn`                          | not needed (`Hash`/`Equal`); possible escape hatch            |
| ✅ `persister` / `schema`                 | phase 6 (Schema required to persist)                          |
| `subscribed`                              | `subscribed: false` → read without observing                  |
| ✅ `maxPages` (infinite)                  | phase 5                                                       |

## Query result fields

`status`, `fetchStatus`, `isPending`, `isSuccess`, `isError`, `isFetching`,
`isLoading`, `isRefetching`, `isPaused`, `isLoadingError`, `isRefetchError`,
`isPlaceholderData`, `isStale`, `isEnabled`, `isFetched`,
`isFetchedAfterMount`, `data`, `error`, `dataUpdatedAt`, `errorUpdatedAt`,
`errorUpdateCount`, `failureCount`, `failureReason`, `refetch()`, plus
**`result: AsyncResult<A, E>`** (Effect-native). Per D2, `data`, `error`,
`failureReason`, `dataUpdatedAt` and `errorUpdatedAt` are `Option`s and never
`undefined`.

## React API

| TanStack                                                                            | effect-atom-query                                                             | Phase   |
| ----------------------------------------------------------------------------------- | ----------------------------------------------------------------------------- | ------- |
| ✅ `QueryClientProvider`, `useQueryClient`                                          | same (wraps `RegistryProvider`)                                               | 2       |
| ✅ `useQuery`                                                                       | `useQuery`                                                                    | 2       |
| ✅ `useQueries` (+`combine`)                                                        | `useQueries`                                                                  | 2       |
| ✅ `useIsFetching`                                                                  | `useIsFetching`                                                               | 2       |
| ✅ `useMutation`                                                                    | `useMutation`: `mutate` + `mutateEffect` (no `mutateAsync`, D4)               | 4       |
| ✅ `mutateAsync` (Promise)                                                          | `useRunEffect().promiseExit(mutateEffect(x))`: the one Promise boundary (D11) | 1.3     |
| ✅ `useMutationState`, `useIsMutating`                                              | same                                                                          | 4       |
| ✅ `useSuspenseQuery`, `useSuspenseQueries`                                         | same (`useAtomSuspense`)                                                      | 5       |
| ✅ `useInfiniteQuery`, `useSuspenseInfiniteQuery`                                   | same                                                                          | 5       |
| ✅ `usePrefetchQuery`, `usePrefetchInfiniteQuery`                                   | same                                                                          | 5       |
| ✅ `QueryErrorResetBoundary`, `useQueryErrorResetBoundary`                          | same                                                                          | 5       |
| `HydrationBoundary`                                                                 | same (atom-react `HydrationBoundary`)                                         | post-v1 |
| ✅ `useIsRestoring`                                                                 | `useIsRestoring`; no provider needed (the client tracks restoring)            | 6       |
| `queryOptions` ✅, `infiniteQueryOptions` ✅, `mutationOptions` (= `Mutation.make`) | thin aliases over `Query.single` etc. (D1)                                    | 1       |

## QueryClient (every method returns `Effect`, with no Promise facade, D4; getters return `Option`, D2)

| Method                                                                      | Phase              |
| --------------------------------------------------------------------------- | ------------------ |
| ✅ `fetchQuery` / `query`, `prefetchQuery`, `ensureQueryData`               | 1                  |
| ✅ `getQueryData`, `getQueryState`, `getQueriesData`                        | 1                  |
| ✅ `setQueryData`, `setQueriesData` (updater returning `None` = no-op)      | 4                  |
| ✅ `invalidateQueries` (`refetchType`), `refetchQueries` (`cancelRefetch`)  | 4                  |
| ✅ `cancelQueries` (`revert`), `resetQueries`, `removeQueries`, `clear`     | 3 / 4              |
| ✅ `isFetching`, `isMutating`                                               | 2 / 4              |
| ✅ `setQueryDefaults`, `setMutationDefaults`, `getDefaultOptions`, …        | 4                  |
| ✅ `resumePausedMutations`                                                  | 6                  |
| ✅ `fetchInfiniteQuery`, `prefetchInfiniteQuery`, `ensureInfiniteQueryData` | 5                  |
| ✅ `mount` / `unmount` (focus/online listener refcount)                     | 3 (scoped `Layer`) |

## Query filters

`queryKey` (prefix match), `exact`, `type: 'all' | 'active' | 'inactive'`,
`stale`, `fetchStatus`, `predicate`. Mutation filters: `mutationKey`, `exact`,
`status`, `predicate`.

## Tooling (phase 7)

| TanStack                                | effect-atom-query                                                                             | Phase |
| --------------------------------------- | --------------------------------------------------------------------------------------------- | ----- |
| ✅ `@tanstack/react-query-devtools`     | `@effect-atom-query/devtools` (`QueryDevtools`, `QueryDevtoolsPanel`), stripped in production | 7     |
| ✅ devtools internals                   | `QueryInspector` (public snapshots + actions) in the core package                             | 7     |
| ✅ bundle size tracking                 | `size-budget.json`, checked by `pnpm size` in `ready`                                         | 7     |
| ✅ docs site + examples                 | `apps/docs` (VitePress); 12 playground examples matching TanStack's                           | 7     |
| SSR (`dehydrate` / `HydrationBoundary`) | not started (deferred)                                                                        | later |

## Testing (`@effect-atom-query/react/testing`, 1.3)

| TanStack / RTK                                   | effect-atom-query                                                            |
| ------------------------------------------------ | ---------------------------------------------------------------------------- |
| test `QueryClient` with `retry: false`           | `testQueryClientLayer()` / `testDefaultOptions`                              |
| `renderWithProviders` / wrapper helpers          | `makeTestHarness({ layer })`: runtime, registry, `Wrapper`, `run`, `dispose` |
| never-resolving `fetch` mocks for loading states | `controlled()`                                                               |
| hook result fixtures                             | `queryHookResult` / `mutationHookResult` + `QueryResult.idle()` etc.         |
