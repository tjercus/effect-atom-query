# React hooks

Every hook needs a `QueryClientProvider` above it.

| hook                                                     | TanStack equivalent          |
| -------------------------------------------------------- | ---------------------------- |
| `useQuery(query, options?)`                              | `useQuery`                   |
| `useSuspenseQuery(query, options?)`                      | `useSuspenseQuery`           |
| `useQueries({ queries, combine? })`                      | `useQueries`                 |
| `useSuspenseQueries({ queries, combine? })`              | `useSuspenseQueries`         |
| `useInfiniteQuery` / `useSuspenseInfiniteQuery`          | same                         |
| `usePrefetchQuery` / `usePrefetchInfiniteQuery`          | same                         |
| `useMutation(mutation, callbacks?)`                      | `useMutation`                |
| `useMutationState(options?)`                             | `useMutationState`           |
| `useIsFetching(filters?)` / `useIsMutating(filters?)`    | same                         |
| `useIsRestoring()`                                       | same                         |
| `useQueryClient()`                                       | same, but its API is Effects |
| `QueryErrorResetBoundary` / `useQueryErrorResetBoundary` | same                         |

Atom hooks from `@effect/atom-react` (`useAtomValue`, `useAtom`, …) work on
query and mutation atoms too. The `use*Query` hooks add per-component options.

## One app-wide registry

`QueryClientProvider` creates a fresh `AtomRegistry` by default. In an app that
also uses atoms outside React (actions that set state after a login, an HTTP
layer that reads the auth token), create the registry yourself and pass it in.
The provider binds the client into it and provides it to hooks, so React, plain
code and query atoms all share one registry:

```tsx
import { scheduleTask } from "@effect/atom-react";
import { AtomRegistry } from "effect/reactivity";

// React's scheduler, as the provider's own registry uses
export const registry = AtomRegistry.make({ scheduleTask });

// plain code, outside React
export const login = (user: User) => registry.set(userAtom, Option.some(user));

createRoot(el).render(
  <QueryClientProvider runtime={runtime} registry={registry}>
    <App />
  </QueryClientProvider>,
);
```

With `registry`, the `defaultIdleTTL`, `scheduleTask` and `timeoutResolution`
props are not available: set them in `AtomRegistry.make` instead. Pass
`scheduleTask` from `@effect/atom-react` so registry work runs on React's
scheduler, as it does with the provider's own registry.

Use one provider per registry: two mounted providers sharing a registry would
overwrite each other's client, and the provider logs an error. When the
provider unmounts, it unbinds its client from the registry but does not
dispose the registry.

To read query atoms from the registry before the provider renders, bind the
client yourself:
`AtomRegistry.make({ initialValues: [QueryClient.initialValue(client)] })`.

## Per-component options

The definition holds the shared options. Each `useQuery` call can add:

| option                                                           | meaning                                                               |
| ---------------------------------------------------------------- | --------------------------------------------------------------------- |
| `select`                                                         | derive the data this component sees (memoised, structurally shared)   |
| `placeholderData`                                                | a value, a function of the previous data, or `Query.keepPreviousData` |
| `enabled`                                                        | override the definition                                               |
| `staleTime`                                                      | this component's staleness threshold                                  |
| `refetchOnMount` / `refetchOnWindowFocus` / `refetchOnReconnect` | overrides                                                             |
| `refetchInterval` / `refetchIntervalInBackground`                | poll while this component is mounted                                  |
| `retryOnMount`                                                   | override the definition                                               |
| `throwOnError`                                                   | `true` or a predicate: throw typed errors to the error boundary       |
| `notifyOnChangeProps`                                            | `"all"` or a list of properties; see below                            |

```tsx
const titles = useQuery(todosQuery, {
  select: (todos) => todos.map((t) => t.title),
  refetchInterval: "5 seconds",
});
```

Defects (bugs, `Effect.die`) are always thrown to the nearest error boundary.
Typed errors are returned, unless `throwOnError` says otherwise.

## Render optimisation: tracked properties

A component re-renders only when a result property it **read** changes. A
component that only renders `data` does not re-render when a background
refetch flips `isFetching`, as long as the new data is structurally equal.
This is TanStack's tracked-properties behaviour, on by default.

- Destructuring or spreading the result reads (tracks) the properties involved.
- A property read for the first time outside render (in a callback, say) is
  tracked from then on. If it already changed, the component re-renders.
- `notifyOnChangeProps: "all"` turns this off. A list such as
  `["data", "error"]` sets the properties explicitly.

## Paginated lists

```tsx
const [page, setPage] = useState(0);
const projects = useQuery(projectsQuery(page), { placeholderData: Query.keepPreviousData });
usePrefetchQuery(projectsQuery(hasMore ? page + 1 : Query.skipToken));
```

`isPlaceholderData` is `true` while the previous page is shown.

## Several queries

```tsx
const results = useQueries({ queries: ids.map((id) => todoQuery(id)) });
const allLoaded = useQueries({
  queries: [usersQuery, queriesEntry(todosQuery, { select: (todos) => todos.length })],
  combine: (results) => results.every((r) => r.isSuccess),
});
```

`queriesEntry(query, options)` attaches per-entry options with a typed `select`.

## Imperative work

`useQueryClient()` returns the client. Its methods are Effects (see
[The QueryClient](./query-client)). Run them on your runtime:

```tsx
const client = useQueryClient()
<a onMouseEnter={() => runtime.runFork(client.prefetchQuery(todoQuery(id)))} />
```

Hook results also carry `refetch()` (and `fetchNextPage()` / `fetchPreviousPage()`
on infinite queries) as fire-and-forget conveniences.
