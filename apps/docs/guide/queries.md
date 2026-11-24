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

## Live updates

A query can keep its data up to date from a stream of changes, such as a
WebSocket or server-sent events. `run` fetches a snapshot, `stream.updates`
delivers changes to it, and `stream.apply` puts one change into the data:

```ts
const messagesQuery = Query.make({
  key: (room: string) => ["messages", room],
  run: (room) => Effect.flatMap(Chat, (chat) => chat.history(room)),
  stream: {
    updates: (room) => Stream.unwrap(Effect.map(Chat, (chat) => chat.subscribe(room))),
    apply: (messages, message) =>
      messages.some((m) => m.id === message.id)
        ? messages.map((m) => (m.id === message.id ? message : m))
        : [...messages, message],
  },
  staleTime: "Infinity",
});
```

The stream runs while the query has an enabled observer (a mounted
component, a mounted atom), and for one second after the last one left, so
that a remount does not reconnect. It starts together with the first fetch.
Updates that arrive while the first fetch runs are applied to its result.
Data that was fetched before the stream ran (a prefetch, a Suspense fetch,
restored data) misses the updates since then, so the first observer
refetches it, whatever the `staleTime`. A fetch that is still under way when
the stream starts is left to finish, and is followed by another one. Two
settings switch this refetch off, and leave the data marked stale instead:
`refetchOnMount: false` and `staleTime: "static"`.

::: warning `apply` must be idempotent
Applying an update that the data already contains must change nothing:
replace by id in place, as above. Do not append, and do not move the item.
Updates that arrive while a fetch runs are shown at once, and are applied
again to the fetched data. The server may or may not have included them in
that data, so they can be applied twice.
:::

::: warning An update can be older than the fetched data
Idempotent is not enough when the same item can change twice in a short
time. An update that arrives during a fetch is applied to the fetched data,
and that data may already hold a later change of the same item: the older
update then overwrites the newer value, until the later update arrives too.
If the stream can deliver updates late or out of order, give each item a
version (a revision number, an update time from the server) and let `apply`
ignore an update that is not newer:

```ts
apply: (messages, message) => {
  const current = messages.find((m) => m.id === message.id);
  if (current === undefined) {
    return [...messages, message];
  }
  return current.version >= message.version
    ? messages
    : messages.map((m) => (m.id === message.id ? message : m));
},
```

:::

::: warning Updates between the snapshot and the subscription
The stream and the fetch start together, but the library cannot tell when
the stream's subscription is established. If the server takes the snapshot
before the subscription is live, a change in between is in neither of them,
and nothing in the client can find that out. The data stays behind until
something refetches it: an invalidation, a `refetch`, a `refetchInterval`,
or a finite `staleTime` together with a remount or a window focus.

Where that matters, close the gap on the server: let it send the current
state as the first update of the stream, so that `apply` replaces the data
with a snapshot taken after the subscription was established.
:::

The playground has a runnable example with a real WebSocket, including a
button that cuts the connection: `apps/playground/src/examples/Live.tsx`,
with the stream built from a `WebSocket` in `apps/playground/src/quotes.ts`.

Set `staleTime: "Infinity"` on a query with a stream. The stream keeps the
data current, so refetching on mount and on window focus only repeats what
it already delivered. Invalidation, `setQueryData` and optimistic updates
work as for any query: `apply` always runs on the data that is in the cache.

### When the stream fails

A failing stream does not fail the query. The data is still valid, at worst
behind, so `status`, `data` and `error` stay as they are. The state of the
stream is a field of its own on the result:

```ts
result.stream?.status; // "idle" | "open" | "reconnecting" | "closed"
result.stream?.error; // Option<unknown>: the stream's last failure, until its next update
```

Results from queries and hooks always have `stream`. The field is optional
in the type so that results built by hand, in a mock or a story, keep
type-checking without it; that is why it is read with `?.`.

| `stream.status`  | meaning                                                                |
| ---------------- | ---------------------------------------------------------------------- |
| `"idle"`         | not running: the query has no stream, or no enabled observer           |
| `"open"`         | running, without a failure since it started or since its last update   |
| `"reconnecting"` | it failed and is being retried; no update has arrived since            |
| `"closed"`       | it ended, or failed with its retries used up; the data counts as stale |

A stream cannot tell when its connection is established, so `"open"` means
that it is running, not that it is connected.

A failed stream is retried with exponential backoff, from 1 second up to 30
seconds, without a limit; the backoff starts over after an update.
`stream.retry` takes a number, a boolean or a `Schedule`, like a query's
`retry`. Leave reconnecting to the library rather than using `Stream.retry`
yourself, because it has to know that updates were missed. When the stream
fails, the data is marked stale. It is refetched when the first update after
the failure arrives, which shows that the stream works again; refetching on
every attempt would fail along with the stream during an outage. A stream
that reconnects and then stays silent therefore leaves the data stale until
its next update, or until another refetch trigger (window focus, a
`refetchInterval`).

The rule behind this: the data is current when its request was sent after
the last gap in the updates closed. A fetch that is running when a gap
closes (the stream starts, or delivers again after a failure) is never
cancelled. It is left to finish, its data is shown and marked stale, and
one more fetch follows. A connection that keeps dropping therefore cannot
keep the query from loading, and causes at most one request at a time. If
the request for a gap fails, it is not repeated: the data stays stale until
the next gap closes or another refetch trigger fires.

The data is marked stale whenever updates stop arriving: when the stream
stops for lack of observers, and when it closes, whether it ended, used up
its retries, or died. The next observer, window focus or reconnect then
refetches, whatever the `staleTime`; the two exceptions are the same as
above, `refetchOnMount: false` for a new observer and `staleTime: "static"`
for all of them. While the stream is closed, fetched data counts as stale
at once, so those triggers keep refetching.

With `networkMode: "online"` (the default) the stream waits for the network
before each attempt. A defect in the stream, or an `apply` that throws, is
a defect of the query. It also closes the stream, unless `apply` threw while
updates were applied to a fetch result: then only that fetch fails.

A closed stream starts again when the query is reset (`resetQueries`, an
error boundary's reset), or when observers return after all of them left. A
plain refetch does not reopen it.

`updates` is fixed when the stream starts: a new definition for the same
key does not reconnect. `apply` is always the one of the latest definition.

::: warning One key, one kind of definition
The latest definition for a key decides whether it has a stream. If the same
key is also defined without `stream` (a prefetch helper with its own
`Query.single`, say), that definition stops the stream of a mounted query:
the data is refetched once, and no updates arrive until a definition with a
stream is used again. Share one definition per key.
:::

The stream runs with the services of the client's runtime, like a background
refetch. `stream.error` is typed `unknown`; narrow it yourself (a
`Schema.is`, a `_tag` check). Components that do not read `stream` do not
re-render when the stream reconnects. Infinite queries
do not take a stream.

## Reading without React

Query atoms are ordinary atoms:

```ts
registry.get(todoQuery("1")); // QueryResult<Todo, TodoError>
const titles = Atom.map(todosQuery, (r) =>
  QueryResult.map(r, (todos) => todos.map((t) => t.title)),
);
```

Mounting the atom fetches it (once, deduplicated), like a component would.
