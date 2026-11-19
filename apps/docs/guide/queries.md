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

An `undefined` value is part of the key: `["todos", { page: undefined }]` and
`["todos", {}]` are two cache entries (TanStack Query treats them as one).
Leave the property out, or use `Query.skipToken`, when there is no value.

### Key constants

A shared key constant written as a plain array widens to `string[]`, which
is not a tuple starting with a string. `Query.make` or `invalidates` then
fails with "No overload matches this call", far from where the key was
written. Build key constants with `QueryKey.make`, which infers the exact
tuple:

```ts
export const postKeys = {
  all: QueryKey.make("posts"), // readonly ["posts"]
  list: () => QueryKey.make(...postKeys.all, "list"),
  detail: (id: number) => QueryKey.make(...postKeys.all, "detail", id),
};

Query.make({ key: (id: number) => postKeys.detail(id), run: (id) => api.post(id) });
Mutation.make({ run: api.savePost, invalidates: [postKeys.all] });
```

`as const` on each array does the same. `QueryKey.make` also reports a
widened array (`QueryKey.make(...someStrings)`) where the key is built.

Keys of query atoms are `QueryKey.Tagged<A, E>`, so
`client.getQueryData(userQuery(id).key)` is typed as `Option<User>`.

## Options

Unset options fall back to the client's `defaultOptions.queries`, then to
TanStack's defaults.

| option                        | default                                                                                                                      |
| ----------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| `staleTime`                   | `0`. Any `Duration.Input`, or `"static"`; see [Stale time](#stale-time)                                                      |
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

### Stale time

Fresh data is served from the cache. Stale data is served too, but is
refetched in the background on mount, window focus or reconnect.

| `staleTime`   | goes stale            | refetched by invalidation, triggers and `refetchQueries` |
| ------------- | --------------------- | -------------------------------------------------------- |
| `0` (default) | at once               | yes                                                      |
| a duration    | after that time       | yes                                                      |
| `"Infinity"`  | only when invalidated | yes                                                      |
| `"static"`    | never                 | **no**: it fetches only when there is no data            |

For "cached until a mutation invalidates it" (RTK Query's default), use
`"Infinity"`. `"static"` is for data that can never change during the
session, such as configuration: invalidating a static query does nothing.

Set defaults for every query, or per key prefix:

```ts
QueryClient.layer({ defaultOptions: { queries: { staleTime: "10 seconds" } } });

// as an Effect
client.setQueryDefaults(["todos"], { gcTime: "1 hour" });
```

## Request options without a new key

The key is the cache identity. To change how a request is made without
creating a new cache entry, do not put the option in the key.

**Per attempt.** `Query.FetchAttempt` tells `run` which attempt is running:
`0` on the first try, then `1`, `2`, … on retries. For example, bypass an HTTP
cache when retrying:

```ts
const todosQuery = Query.single({
  key: ["todos"],
  run: Effect.gen(function* () {
    const { attempt } = yield* Query.FetchAttempt;
    return yield* TodoApi.use((api) => api.list({ noCache: attempt > 0 }));
  }),
});
```

**Per request.** Request options are services. Declare one with a default, so
reading it adds nothing to the query's `R`, and provide it where you refetch:

```ts
const BypassCache = Context.Reference<boolean>("app/BypassCache", {
  defaultValue: () => false,
});

const todosQuery = Query.single({
  key: ["todos"],
  run: Effect.gen(function* () {
    const noCache = yield* BypassCache;
    return yield* TodoApi.use((api) => api.list({ noCache }));
  }),
});

// Same key, same cache entry, different request:
client
  .refetchQueries({ queryKey: todosQuery.key, exact: true })
  .pipe(Effect.provideService(BypassCache, true));
```

`refetchQueries`, `invalidateQueries`, `resetQueries` and `fetchQuery` run the
fetches they start with the caller's services. So does a mutation's
`invalidates`: its refetches get the services of the `mutate` call.

Everything else uses only the client's services, so `BypassCache` is `false`
there: fetches on mount, focus, reconnect and polling, and the hooks'
`refetch()`, `fetchNextPage()` and `fetchPreviousPage()`. From a component,
run the client's methods through
[`useRunEffect`](./react#waiting-for-a-refetch) instead.

A refetch that joins a fetch already running keeps that fetch's services.
That happens during a first load (no data yet), and with
`cancelRefetch: false`.

## Disabling queries

Pass `Query.skipToken` instead of the argument to get a disabled query with the
same types. No `undefined` argument, no `!`:

```ts
import { Query, QueryResult, useQuery } from "@effect-atom-query/react";

const projects = useQuery(
  QueryResult.match(user, {
    onPending: () => projectsQuery(Query.skipToken),
    onFailure: () => projectsQuery(Query.skipToken),
    onSuccess: (success) => projectsQuery(success.data.value.id),
  }),
);
```

`enabled: false` (in the definition or as a hook option) also disables a query.

`Query.single` queries have no argument, so they cannot take
`Query.skipToken`. Disable them with `enabled`:

```ts
const settings = useQuery(settingsQuery, { enabled: session.isSuccess });
```

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

## Errors

`error` holds the query's typed failure: the `E` of `run`. To change what
consumers see (RTK Query's `transformErrorResponse`), map it in `run`. The
query's error type follows:

```ts
const auditQuery = Query.make({
  key: (id: string) => ["audit", id],
  run: (id) => api.audit(id).pipe(Effect.mapError(toAuditError)), // Effect<Audit, AuditError, Api>
});
```

Give error classes a real `message`. An error built with `Data.TaggedError`
has a `message` of `""` unless you set one, so UI code that shows
`error.message`, or prefers it over a fallback, shows an empty string:

```ts
class ApiError extends Data.TaggedError("ApiError")<{
  readonly status: number;
  readonly message: string;
}> {}
```

## Structural sharing

When a refetch returns data, every part of it that is deeply equal to the
previous data keeps its previous reference. If nothing changed, `data` is the
same object as before. Components, memoised selectors and effects that
depend on the data do not see a change.

Only plain objects and arrays are compared. Class instances, `Data` values,
`Date`s and other non-plain values are taken from the new data. Set
`structuralSharing: false` to always use the new data, or pass a function
`(oldData, newData) => data` to merge yourself.

## Reading without React

Query atoms are ordinary atoms:

```ts
registry.get(todoQuery("1")); // QueryResult<Todo, TodoError>
const titles = Atom.map(todosQuery, (r) =>
  QueryResult.map(r, (todos) => todos.map((t) => t.title)),
);
```

Mounting the atom fetches it (once, deduplicated), like a component would.
