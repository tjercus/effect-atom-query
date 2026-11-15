---
"@effect-atom-query/query": minor
"@effect-atom-query/react": minor
---

Test utilities. In the core, `QueryResult.idle()` builds what a query disabled with `enabled: false` returns, and `QueryResult.disabled()` no longer needs an argument. A new entry point, `@effect-atom-query/react/testing`, adds `makeTestHarness` (a client with test defaults, your fake services, a registry and a `Wrapper` provider, plus `run` and `dispose`), `controlled()` (a fake response that stays pending until the test completes it), `queryHookResult` / `mutationHookResult` (hook results for mocks, without casts) and `testQueryClientLayer` / `testDefaultOptions` (no retries, no focus or reconnect refetches, no gc timers). The main entry point and its size are unchanged.
