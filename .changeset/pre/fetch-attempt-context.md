---
"@effect-atom-query/query": minor
"@effect-atom-query/react": minor
---

Request options without a new query key. `Query.FetchAttempt` tells a query's `run` which attempt is running (`0`, then `1`, `2`, … on retries), for example to bypass an HTTP cache when retrying. `refetchQueries`, `invalidateQueries` and `resetQueries` now run the fetches they start with the caller's services, as `fetchQuery` already did, so request options can be provided as services (`Effect.provideService`) while the cache entry stays the same. A mutation's `invalidates` refetches with the services of its `mutate` call.
