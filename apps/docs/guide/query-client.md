# The QueryClient

The client is an Effect service. Every method returns an `Effect` (decision
D4: no Promise API). Errors and requirements stay typed:

```ts
const program = Effect.gen(function* () {
  const client = yield* QueryClient.QueryClient;
  const todo = yield* client.fetchQuery(todoQuery("1")); // Effect<Todo, TodoError, TodoRepo>
  yield* client.invalidateQueries({ queryKey: ["todos"] });
});
```

In components, `useQueryClient()` returns the same service. Run its Effects
on your runtime (`runtime.runFork(...)`).

## Reading

| method                                           | returns                               |
| ------------------------------------------------ | ------------------------------------- |
| `fetchQuery(query, { staleTime?, retry? })`      | the data, from cache if fresh         |
| `prefetchQuery(query)`                           | `void`, never fails                   |
| `ensureQueryData(query, { revalidateIfStale? })` | cached data or a fetch                |
| `getQueryData(query \| key)`                     | `Option<A>`; typed from a query's key |
| `getQueriesData(filters)`                        | `[key, Option<A>]` pairs              |
| `getQueryState(query \| key)`                    | `Option<QueryResult>`                 |
| `isFetching(filters?)` / `isMutating(filters?)`  | counts                                |

## Writing

| method                                                                 | TanStack semantics                          |
| ---------------------------------------------------------------------- | ------------------------------------------- |
| `setQueryData(query \| key, value \| (prev: Option<A>) => Option<A>)`  | returning `None` leaves the cache unchanged |
| `setQueriesData(filters, updater)`                                     |                                             |
| `invalidateQueries(filters, { refetchType })`                          | mark stale, refetch active (default)        |
| `refetchQueries(filters)`                                              |                                             |
| `resetQueries(filters)`                                                | back to initial state, refetch active       |
| `cancelQueries(filters, { revert })`                                   | interrupt the fetch fibers                  |
| `removeQueries(filters)` / `clear`                                     |                                             |
| `setQueryDefaults(key, options)` / `setMutationDefaults(key, options)` | prefix-matched defaults                     |
| `mutate(mutation, input)`                                              | run a mutation                              |
| `resumePausedMutations`                                                | run mutations restored from storage         |

Filters are TanStack's: `queryKey` (prefix match unless `exact`), `type`
(`"active" | "inactive" | "all"`), `stale`, `fetchStatus`, `predicate`.

## Lifetime

`QueryClient.layer(options)` builds the client in a scope. Closing the
runtime interrupts every background fiber: fetches, gc timers, polling, and
the focus and online subscriptions. `QueryClient.make` is the scoped
constructor, for building a client inside your own Effect program.

## Focus and connectivity

`FocusManager` and `OnlineManager` are services with browser defaults. Replace
them with `FocusManager.layer(...)` / `OnlineManager.layer(...)`, for example to
hook React Native's `AppState` and NetInfo. You can also drive them as Effects:
`OnlineManager.setOnline(false)`.
