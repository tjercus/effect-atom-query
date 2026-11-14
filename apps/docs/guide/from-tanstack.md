# Coming from TanStack Query

The caching model is TanStack Query's: the same defaults, the same lifecycle
(fresh, stale, inactive, garbage collected), and the same triggers, filters
and hooks. What changes is the language around it.

| TanStack Query                                          | effect-native-query                                                 |
| ------------------------------------------------------- | ------------------------------------------------------------------- |
| `queryFn: () => Promise<T>`                             | `run: Effect<A, E, R>`: typed errors, services from the runtime     |
| `queryKey` + `queryFn` passed to every hook             | queries defined once (`Query.make`); hooks receive the atom         |
| `queryOptions({ ... })`                                 | `Query.single` / `Query.make` (`Query.queryOptions` alias)          |
| `data: T \| undefined`, `error: E \| null`              | `data: Option<A>`, `error: Option<E>`, plus `cause` for defects     |
| `retry: 3`, `retryDelay`                                | `retry: 3`, or any `Schedule`                                       |
| `AbortSignal`                                           | fiber interruption, so nested Effects are cancelled too             |
| `enabled: !!id`                                         | `todoQuery(id ?? Query.skipToken)`, or `enabled`                    |
| `queryClient.fetchQuery()` → `Promise`                  | `client.fetchQuery(query)` → `Effect`                               |
| `new QueryClient()` + `QueryClientProvider client`      | `QueryClient.layer()` in a runtime + `QueryClientProvider runtime`  |
| `onMutate` / `onError` / `onSettled` returning promises | the same callbacks returning Effects, with `QueryClient` in context |
| `onSettled: () => invalidateQueries(...)`               | `invalidates: [["todos"]]`                                          |
| `useMutationState({ select })`                          | the same; also `Mutation.optimistic(query, mutation, apply)`        |
| `persistQueryClient` + `dehydrate` options              | `QueryPersister.layer` + per-query `persist: { schema }`            |
| `focusManager`, `onlineManager`                         | `FocusManager` / `OnlineManager` services                           |
| `@tanstack/react-query-devtools`                        | `@effect-native-query/devtools`                                     |

## Not (yet) supported

- SSR: `dehydrate`/`hydrate` and `HydrationBoundary` are planned after v1.
- A default `queryFn` keyed by `queryKey`. Every query declares its own `run`,
  which is what makes the types flow.
- `streamedQuery` and `experimental_prefetchInRender`.
- Promise-returning client methods. The imperative API is Effect-only by
  design.

## Atoms all the way

Every query and mutation is an Effect Atom. Anything in `effect/reactivity`
composes with them (`Atom.map`, `Atom.family`, `useAtomValue`, `AtomRegistry`
outside React), and `QueryResult.result` is the underlying `AsyncResult`.
