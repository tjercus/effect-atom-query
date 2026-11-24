# RTK Query features not yet supported

Date: 2026-11-23, against version 1.4.0.

This report lists RTK Query (RTKQ) features that effect-atom-query does not
support yet, and advises which ones are worth adding. It is advice, not a
plan: nothing here is scheduled.

Most of RTKQ is covered already. The concept map in
[Coming from Redux / RTK Query](../apps/docs/guide/from-redux.md) shows the
equivalent for each feature, and [FEATURE-MATRIX.md](./FEATURE-MATRIX.md)
does the same for TanStack Query. This report covers what is left.

The gaps were found by comparing the RTKQ API with the guides in
`apps/docs/guide` and the source in `packages/query/src` and
`packages/react/src`. One item, marked "to verify", is a behaviour that was
not checked in the code.

## Summary

| #   | RTKQ feature                                          | Status here                               | Value  | Effort |
| --- | ----------------------------------------------------- | ----------------------------------------- | ------ | ------ |
| 1   | Streaming cache updates (`onCacheEntryAdded`)         | implemented after 1.4.0 (`stream`)        | high   | large  |
| 2   | Tags derived from the result (`providesTags(result)`) | missing; keys depend on the argument only | high   | medium |
| 3   | Endpoint schemas (`responseSchema`, `argSchema`, …)   | schema only under `persist`               | medium | small  |
| 4   | SSR and hydration                                     | deferred (decision D3)                    | high   | medium |
| 5   | Code generation from an API description               | missing                                   | medium | large  |
| 6   | `useLazyQuery`                                        | missing; workaround exists                | medium | small  |
| 7   | Global failure handling (listener middleware)         | change notifications without a payload    | medium | small  |
| 8   | `invalidationBehavior: "delayed"`                     | to verify                                 | low    | small  |
| 9   | `upsertQueryEntries`                                  | `setQueryData`, one entry at a time       | low    | small  |
| 10  | Re-authentication recipe (`baseQueryWithReauth`)      | not documented                            | low    | docs   |

## Worth adding

### 1. Streaming cache updates

**Implemented** after this report was written, as the `stream` option of
`Query.make` and `Query.single`; see
[Live updates](../apps/docs/guide/queries.md#live-updates). The analysis and
the design below are kept as the record of why it works the way it does.
[What was built](#what-was-built) lists where the implementation differs.

In RTKQ, `onCacheEntryAdded` lets an endpoint fetch once and then keep its
cache entry up to date from a WebSocket or server-sent events, for as long as
the entry is in the cache. The endpoint awaits `cacheDataLoaded`, applies
messages with `updateCachedData`, and closes the connection after
`cacheEntryRemoved`.

effect-atom-query has nothing like it: no module in `packages/query/src` uses
`Stream`, and the TanStack guide lists `streamedQuery` as not supported.

This is the largest gap, and also where Effect can do better than RTKQ. A
query option that takes a `Stream` of updates and a function folding each
update into the cached data would need no manual lifecycle code: the stream
runs in a scope tied to the entry's observers, and interruption closes the
connection. The design questions are when the stream starts (after the first
successful fetch, as in RTKQ, or instead of it), what a refetch does while
the stream runs, and how stream failures show in the result.

#### Proposed design

In short: the fetch gives a snapshot, the stream gives updates to it; a new
snapshot replaces the data; and a failing stream never turns good data into
an error.

**When the stream starts.** With the entry's first observer, at the same time
as the fetch. Updates that arrive before the first successful fetch are
buffered, and applied in order once the data is there.

- Starting only after the fetch, as RTKQ code usually does, loses the updates
  sent between the snapshot and the subscription. Subscribing first closes
  that gap.
- Starting the stream instead of the fetch would leave the fold without data
  to apply an update to. With a snapshot first, the fold is
  `(data: A, update: U) => A`, with no `Option`. A source that only streams
  uses `initialData`, or a `run` that returns an empty value.
- If the fetch fails, the buffer is dropped. The next successful fetch is the
  new base.

**When the stream stops.** When the last observer leaves, after a short grace
period so that a remount (or React's StrictMode) does not reconnect. It does
not wait for `gcTime`: RTKQ keeps the connection until the cache entry is
removed, which here would mean an open socket for five minutes that nobody
reads. Because updates are missed from then on, stopping marks the entry as
invalidated, so the next observer refetches whatever the `staleTime`.

**A refetch while the stream runs.** The snapshot replaces the data, and the
updates received during the fetch are applied again on top of it:

1. While the fetch runs, each update is applied to the current data at once,
   so the UI stays live, and is also recorded.
2. When the snapshot arrives, it becomes the data, the recorded updates are
   applied to it in order, and the record is cleared.

The snapshot may already contain a recorded update, so **the fold must be
idempotent**: insert or replace by id, never append. This is the one rule
users have to know, and the alternative (sequence numbers that say which
updates a snapshot includes) would put knowledge of the protocol into the
library.

Everything else keeps working as it does now:

- `invalidates`, `setQueryData` and optimistic updates are unchanged. The
  fold always runs on the data currently in the cache, so they compose with
  the stream. `cancelQueries` interrupts the fetch, not the stream.
- Staleness is unchanged. The docs should advise `staleTime: "Infinity"` for
  streamed queries, so that mounting and window focus do not refetch what the
  stream already delivers.
- Each update sets `dataUpdatedAt` and goes through structural sharing.
- The library reconnects, with a `retry` `Schedule` in the stream's options
  (exponential backoff by default, without a limit while the entry is
  observed). Users should not use `Stream.retry` for this, because the
  library has to see each reconnect: updates were missed, so it invalidates
  the entry and fetches a new snapshot. The same happens when the stream
  resumes after being paused offline (`networkMode`, `OnlineManager`).

**How failures show.** Apart from the query's `status` and `error`, in two new
fields of the result: `streamStatus` (`"idle"`, `"connecting"`,
`"connected"`, `"reconnecting"` or `"closed"`) and
`streamError: Option<E2>`.

- Putting stream failures in `error` would widen its type to `E | E2`, set
  `isError`, and trigger `throwOnError` and error boundaries while the data
  is still good. A failed refetch already keeps the previous data; a failed
  stream is a weaker failure than that, since the data is valid and at worst
  behind.
- While reconnecting: `"reconnecting"`, the data stays, and `streamError`
  holds the last failure.
- When the retries are used up: `"closed"`, `streamError` stays, and the
  entry is invalidated. From then on it behaves as a query without a stream:
  the usual refetch triggers and `refetchInterval` apply.
- When the stream ends without a failure: `"closed"`, no error, no restart.
- A defect in the stream or the fold is thrown, like defects elsewhere.
- With tracked properties, a component that does not read `streamStatus`
  does not re-render when the stream reconnects.

**Trade-offs.**

- The idempotent fold is the main way to get this wrong. It needs a clear
  explanation and an example in the guide.
- The buffer before the first fetch is unbounded. In practice it holds a few
  seconds of updates; a limit can be added later.
- The stream runs with the client runtime's services only, like a background
  refetch. It cannot use services provided by a caller.

#### What was built

The implementation follows the design, with these differences:

- **The gap between snapshot and subscription is narrowed, not closed.** The
  stream and the fetch start together, but a `Stream` gives no signal when
  its subscription is established. If the server takes the snapshot before
  the subscription is live, an update in between is lost, both on the first
  load and after a reconnect, and nothing repairs it until the next refetch.
  Closing the gap needs an API where connecting is an `Effect` that the
  library waits for before it fetches; that is a possible follow-up. Until
  then, a source that must not miss updates should send its own snapshot as
  the first update, taken after the subscription was established.

- **After a reconnect, the refetch waits for the first update.** The design
  refetched each time the stream ran again. During an outage that refetch
  fails with every attempt, which puts a query with good data in its error
  state. Now a failure marks the data stale, and the refetch happens when the
  first update after it arrives. A stream that reconnects and stays silent
  leaves the data stale until then. That refetch replaces a running fetch,
  also the first one, because its request may be from before the failure.
- **A fetch does not undo what the stream missed while it ran.** When the
  stream fails or stops during a fetch, the result of that fetch stays
  invalidated, also when the fetch is cancelled.
- **`fetchQuery` returns what goes into the cache**: the fetched data with
  the recorded updates applied. If `apply` throws on it, the fetch fails.
- **Data fetched before the stream ran is refetched** by the first observer
  (after a prefetch, a Suspense fetch or a restore), whatever the
  `staleTime`, because it misses the updates since.
- **During a background restore** by a persister, the stream is held back
  like the mount fetch. Once restored, the data is refetched and the stream
  starts.
- **A closed stream starts again** on `resetQueries`, or when observers
  return. `updates` is fixed when the stream starts; `apply` follows the
  latest definition.
- **Statuses.** `streamStatus` is `"idle"`, `"open"`, `"reconnecting"` or
  `"closed"`. The design's `"connecting"` and `"connected"` cannot be told
  apart: a `Stream` gives no signal when its connection is established.
  `"open"` means that the stream is running and has not failed since it
  started or since its last update.
- **`streamError` is `Option<unknown>`**, not `Option<E2>`. A typed error
  needs a third type parameter on `QueryResult`, the query atoms and every
  hook. That can be added later; until then, consumers narrow the value.
- **Updates without data are only kept while a fetch runs.** With no data and
  no fetch (after a failed first fetch, say) they are dropped, since the next
  fetch returns newer data anyway. The record of updates is cleared when each
  attempt of a fetch sends its request, so it holds the updates of one
  request, or of one wait for the network.
- **The grace period is fixed at one second.** It is not an option yet.
- **The fold is called `apply`**, and the options are
  `stream: { updates, apply, retry }`.
- **A defect** in the stream or in `apply` puts the query in its error state
  (which the React bindings throw to the error boundary) and closes the
  stream.
- **Infinite queries** do not take a stream.

### 2. Tags derived from the result

In RTKQ, `providesTags` can be a function of the result. A list query
provides one tag per item it returned, so a mutation on post 5 invalidates
only the lists that contain post 5.

Here a query's key plays the role of its tags, and the key depends on the
argument only. Invalidation matches keys by prefix. Someone porting from RTKQ
must either invalidate more than needed (`postKeys.all`) or write a
`predicate` by hand.

For apps with lists and details of the same entities this is the difference
RTKQ users will notice most. One option is a `tags` function of the data on
the query, with `invalidates` matching on those tags as well as on keys. The
design must fit `reactivityKeys`, which already invalidates through Effect's
`Reactivity` service, so that there are not three overlapping mechanisms.

### 3. Endpoint schemas

Since version 2.7, RTKQ endpoints accept Standard Schema validators:
`argSchema`, `responseSchema`, `rawResponseSchema`, `errorResponseSchema` and
`metaSchema`, with `catchSchemaFailure` to turn a failed validation into an
error value.

Here a schema appears only under `persist`. Validating a response is done by
hand inside `run`, as the `parse` option of the `ApiClient` in the migration
guide shows.

A `schema` option on the query could validate the result of `run`, serve as
the `persist` schema, and give the query its data type. The library already
accepts Standard Schema validators for persistence, so zod users could port
their schemas unchanged. This is a small change that makes two existing
features work together, and a good first step.

### 4. SSR and hydration

RTKQ supports server rendering with `extractRehydrationInfo` and
`getRunningQueriesThunk`. Here it is deferred (decision D3 in
[QUESTIONS.md](./QUESTIONS.md), and "not started" in the feature matrix), and
it remains the main blocker for apps on Next.js or React Router's framework
mode.

Most of the work is done: `QueryPersister` already has `dehydrate`,
`hydrate` and the `PersistedClient` schema. What is missing is a
`HydrationBoundary`, server defaults (no retries, no garbage collection), and
a way to wait for all running queries before rendering.

### 5. Code generation

RTKQ ships `@rtk-query/codegen-openapi` and a GraphQL generator, which write
endpoint definitions from an API description.

Copying the OpenAPI generator is not advised. Effect already has typed API
descriptions (`HttpApi`, `RpcGroup`), and `effect/reactivity` derives atoms
from them (`AtomHttpApi`, `AtomRpc`). A separate package that derives `Query`
and `Mutation` definitions from an `HttpApi` would give the same result as
code generation, typed from end to end and without generated files. Teams
with only an OpenAPI document could generate the `HttpApi` first.

## Smaller additions

### 6. `useLazyQuery`

RTKQ's `useLazyQuery` returns a trigger, the result and the last argument,
for fetches started by an event: search on submit, an export button.

There is no lazy hook here. The workarounds are `useRunEffect` with
`client.fetchQuery`, or keeping the argument in state and passing
`Query.skipToken` until it is set. A thin hook over the second workaround
would remove a common source of friction when porting.

### 7. Global failure handling

RTKQ apps commonly handle failures in one place with listener middleware and
`isRejectedWithValue`: a toast for every failed request, a logout on a 401.

Here `client.cache.subscribe` and `QueryInspector.subscribe` notify that
something changed, without saying what. There is no client-level `onError`
and no stream of cache events. A typed stream of events (query failed,
mutation failed, with the key and the cause) would cover this. The devtools
would benefit from it as well.

### 8. Delayed invalidation (to verify)

RTKQ 2 delays invalidation by default (`invalidationBehavior: "delayed"`):
tags invalidated by a mutation take effect only after all running queries
and mutations have settled. This avoids a refetch that returns data from
before a second, still running mutation.

Here a mutation waits for its own invalidated queries to refetch. What
happens when several mutations overlap is not documented and was not checked
for this report. The first step is a test that shows the behaviour; then
either document it or add the option.

### 9. `upsertQueryEntries`

RTKQ's `upsertQueryEntries` writes many cache entries at once, typically to
fill the detail entries from a list response. `setQueryData` does this one
entry at a time. A bulk variant is a convenience; a documented recipe for
"the list fills the details" may be enough.

### 10. Re-authentication recipe

The RTKQ documentation has a `baseQueryWithReauth` example: on a 401, refresh
the token once (behind a mutex) and repeat the request. Here that belongs in
the app's `ApiClient` service and needs no library feature, but the migration
guide does not show it. Adding the recipe, with a retry on 401 and a
semaphore around the refresh, is a documentation task.

## Not worth adding

- **`injectEndpoints` / `enhanceEndpoints`.** Queries are module-level
  definitions, so code splitting needs no API.
- **`useQueryState` / `useQuerySubscription`.** Tracked properties cover
  subscribing without re-rendering, and `client.getQueryState` reads a
  result without subscribing.
- **`currentData`, `skipPollingIfUnfocused`,
  `refetchOnMountOrArgChange: <seconds>`, `serializeQueryArgs` / `merge`,
  `extraOptions`, `fixedCacheKey`.** Covered by `placeholderData`,
  `refetchIntervalInBackground`, `staleTime`, key functions and infinite
  queries, services and `Query.FetchAttempt`, and `mutationKey` with
  `useMutationState`.
- **Redux DevTools time travel.** It does not fit atoms; the devtools
  package shows the cache instead.

## Suggested order

1. Endpoint `schema` (3): small, and it builds on persistence.
2. `useLazyQuery` (6) and the failure event stream (7): cheap, and they
   remove friction for people porting from RTKQ.
3. Streaming updates (1): done.
4. Tags derived from the result (2): design it together with
   `reactivityKeys`.
5. SSR (4), then the `HttpApi` integration (5) as a separate package.

All of these are additions, so each is a minor release, and each goes to the
`next` dist-tag first ([RELEASING.md](./RELEASING.md)).
