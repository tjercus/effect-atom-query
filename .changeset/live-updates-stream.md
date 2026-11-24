---
"@effect-atom-query/query": minor
"@effect-atom-query/react": minor
---

Live updates: a query can keep its data up to date from a `Stream` (a WebSocket, server-sent events). `Query.make` and `Query.single` take `stream: { updates, apply, retry }`: `run` fetches a snapshot, `updates` delivers changes, and `apply` puts one change into the data. `apply` must be idempotent.

- The stream runs while the query has an enabled observer, and for one second after the last one left. It starts together with the first fetch; updates that arrive while a fetch runs are applied to its result as well. Data fetched before the stream ran is refetched by the first observer.
- A fetch that runs when the stream starts or recovers is not cancelled: it finishes, and one more fetch follows.
- A failing stream does not fail the query. Results have a new field, `stream`, with `status` (`"idle"`, `"open"`, `"reconnecting"`, `"closed"`) and `error`. The stream is retried with backoff. A failure marks the data stale, and it is refetched when the first update after the failure arrives.
- When the stream stops for lack of observers, or closes, the query is invalidated, so the next observer refetches.

`refetchQueries`, `invalidateQueries` and a mutation's `invalidates` now wait for the fetch that replaced the one they started, for any query: a refetch that was superseded by another (`cancelRefetch`) is not done until its successor is.

`stream` is optional in the type of `QueryResult`, so code that builds a result by hand (a mock, a story) keeps type-checking. Results from queries and hooks always have it; read it as `result.stream?.status`.
