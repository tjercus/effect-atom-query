# Queries

## Defining queries

| constructor                  | use for                                               |
| ---------------------------- | ----------------------------------------------------- |
| `Query.single({ key, run })` | one query with a fixed key                            |
| `Query.make({ key, run })`   | a family of queries, `key` and `run` take an argument |
| `Query.queryOptions(...)`    | alias of `Query.single`, for TanStack-style naming    |

```ts
const userQuery = Query.make({
  key: (id: UserId) => ["user", id],
  run: (id) => Users.use((users) => users.get(id)), // Effect<User, UserNotFound, Users>
  staleTime: "1 minute",
  retry: Schedule.spaced("2 seconds").pipe(Schedule.upTo({ times: 3 })),
});
```

The query atom's type, `QueryAtom<User, UserNotFound, Users>`, carries the data,
error and requirement types. Errors stay typed all the way to the component.

## Keys

A key is a readonly tuple starting with a string: `["user", id]`,
`["todos", { status: "done", page: 2 }]`. Keys compare structurally (Effect
`Equal`), object property order does not matter, and filters match by prefix:
`invalidateQueries({ queryKey: ["todos"] })` matches every key starting with
`"todos"`.

Keys of query atoms are `QueryKey.Tagged<A, E>`, so
`client.getQueryData(userQuery(id).key)` is typed as `Option<User>`.

## Options

Unset options fall back to the client's `defaultOptions.queries`, then to
TanStack's defaults.

| option                        | default                                                                                                                      |
| ----------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| `staleTime`                   | `0`. Any `Duration.Input`, or `"static"`                                                                                     |
| `gcTime`                      | `"5 minutes"`                                                                                                                |
| `retry`                       | `3`, exponential backoff from 1 s capped at 30 s. A number, a boolean, or any `Schedule` (which can inspect the typed error) |
| `refetchOnMount`              | `true` (when stale), or `"always"`                                                                                           |
| `refetchOnWindowFocus`        | `true`                                                                                                                       |
| `refetchOnReconnect`          | `true`                                                                                                                       |
| `refetchInterval`             | `false`, or a duration or function of the result                                                                             |
| `refetchIntervalInBackground` | `false`                                                                                                                      |
| `networkMode`                 | `"online"`, or `"always"` / `"offlineFirst"`                                                                                 |
| `retryOnMount`                | `true`                                                                                                                       |
| `enabled`                     | `true`, or a function of the argument                                                                                        |
| `structuralSharing`           | `true`                                                                                                                       |
| `initialData`                 | none; makes the query a `DefinedQueryAtom`                                                                                   |
| `reactivityKeys`              | none; invalidate on Effect `Reactivity` keys                                                                                 |
| `persist`                     | none; `{ schema }` opts into persistence                                                                                     |

Set defaults for every query, or per key prefix:

```ts
QueryClient.layer({ defaultOptions: { queries: { staleTime: "10 seconds" } } });

// as an Effect
client.setQueryDefaults(["todos"], { gcTime: "1 hour" });
```

## Disabling queries

Pass `Query.skipToken` instead of the argument to get a disabled query with the
same types. No `undefined` argument, no `!`:

```ts
const projects = useQuery(projectsQuery(user.isSuccess ? user.data.value.id : Query.skipToken));
```

`enabled: false` (in the definition or as a hook option) also disables a query.

## Results

Every read gives a `QueryResult<A, E>`, a union of `Pending`, `Success` and
`Failure`:

```ts
result.status; // "pending" | "success" | "error"
result.fetchStatus; // "fetching" | "paused" | "idle"
result.data; // Option<A>
result.error; // Option<E>: None for defects; see result.cause
result.result; // the AsyncResult, for Atom / AsyncResult combinators
(result.isStale,
  result.isFetching,
  result.isRefetching,
  result.isPlaceholderData,
  result.dataUpdatedAt); // Option<DateTime.Utc>
(result.failureCount, result.failureReason); // retries in progress
```

`QueryResult.match(result, { onPending, onSuccess, onFailure })` folds a result,
and `QueryResult.isDefect(result)` tells a defect from a typed failure.

## Reading without React

Query atoms are ordinary atoms:

```ts
registry.get(todoQuery("1")); // QueryResult<Todo, TodoError>
const titles = Atom.map(todosQuery, (r) =>
  QueryResult.map(r, (todos) => todos.map((t) => t.title)),
);
```

Mounting the atom fetches it (once, deduplicated), like a component would.
