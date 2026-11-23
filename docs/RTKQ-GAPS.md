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
| 1   | Streaming cache updates (`onCacheEntryAdded`)         | missing                                   | high   | large  |
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

In RTKQ, `onCacheEntryAdded` lets an endpoint fetch once and then keep its
cache entry up to date from a WebSocket or server-sent events, for as long as
the entry has subscribers. The endpoint awaits `cacheDataLoaded`, applies
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
3. Streaming updates (1): the feature that sets the library apart, but it
   needs a design first.
4. Tags derived from the result (2): design it together with
   `reactivityKeys`.
5. SSR (4), then the `HttpApi` integration (5) as a separate package.

All of these are additions, so each is a minor release, and each goes to the
`next` dist-tag first ([RELEASING.md](./RELEASING.md)).
