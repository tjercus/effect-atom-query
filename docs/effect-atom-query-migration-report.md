# effect-atom-query migration report

Experiment branch: `feature/effect-atom-query-state` (not merged).
Library: `@effect-atom-query/react` + `@effect-atom-query/query` 1.2.0 on `effect` / `@effect/atom-react` 4.1.4.
Decisions taken during the migration are in [`decisions.md`](./decisions.md#effect-atom-query-migration-experiment-branch-featureeffect-atom-query-state).

## Goal

Replace all state management (Redux Toolkit, RTK Query, `redux-localstorage-simple`, `use-local-storage-state`) with effect-atom-query and Effect atoms, and record every integration, usage and feature issue the library surfaces.

## Outcome

The migration is complete and green.

- **Removed:** `src/store.ts`, `src/store.spec.ts`, `src/testUtils/reduxTestUtils.tsx`, all 10 RTK Query API slices and the 3 Redux slices (renamed to `*State.ts` atom modules), and the npm packages `@reduxjs/toolkit`, `react-redux`, `redux-localstorage-simple`, `use-local-storage-state`.
- **Added:** `src/common/state/` (ApiClient service, app runtime, `AppStateProvider`, `persistedAtom`), `src/testUtils/appStateTestUtils.tsx` (`makeTestAppState`), one `*Queries.ts` + spec per former API slice, and atom modules for notification, deep link and multi-step form state.
- **Size:** in `src`, about 9.6k lines added and 10.4k lines removed (incl. new files). About 1.9k of the added lines are new non-test source.

| Check                                             | Result                                                        |
| ------------------------------------------------- | ------------------------------------------------------------- |
| `tsc -p tsconfig.app.json` / `tsconfig.spec.json` | 0 errors                                                      |
| `eslint src`                                      | 0 errors (warnings only, mostly pre-existing rule categories) |
| `vitest run` (full suite)                         | 329 files, 5489 tests passed, no unhandled errors             |
| `npm run build`                                   | succeeds                                                      |

Not done: no manual run of the app against a real backend, and the bundle size was not compared with `develop` (skipped for now).

## Verdict

The library works for this app. Every RTK Query endpoint, including infinite queries, cross-module invalidation and multi-request flows, was expressible, and tests that swap the HTTP layer through an Effect `Layer` are clearly nicer than mocking `fetch`.

The cost is in the integration. The library ships no HTTP layer, no Promise-based mutation API and no test helpers, so the app had to build those itself. One library bug (deferred unbind on a disposed registry) made every component spec fail until worked around. Several behaviour differences from Redux (reference equality, error `message`) caused real bugs that only tests caught. The package is also very young: versions 0.0.0, 1.0.0 and 1.2.0 were all published on 2026-11-14, by a single maintainer.

Issues are tagged:

- **[bug]**: library defect
- **[gap]**: missing library feature that forced app code
- **[types]**: TypeScript ergonomics
- **[docs]**: behaviour that is only discoverable from source
- **[migration]**: a pitfall of moving off Redux, not a library fault

## 1. Library bugs

### 1.1 [bug] `QueryClientProvider` unbinds on a disposed registry

`useRegistryBinding` (`@effect-atom-query/react` `dist/index.mjs`, around line 100) schedules the unbind of the client in a `setTimeout(0)` after unmount. If the registry is disposed first, the timer calls `registry.get(QueryClient.current)`, which throws `Cannot access Atom QueryClient.current: registry is disposed` as an **uncaught exception**.

Every component spec hits this in normal teardown: Vitest runs the spec's `afterEach` (dispose) before RTL's auto-cleanup (unmount). Tests pass but the run fails with unhandled errors (30 in one feature area alone).

- **Workaround:** `makeTestAppState().dispose` (`src/testUtils/appStateTestUtils.tsx`) runs `cleanup()`, waits one tick, then disposes.
- **Upstream fix:** clear the pending timer, or check that the registry is still alive, in the deferred unbind.

## 2. Missing features

### 2.1 [gap] No HTTP layer

The library is transport-agnostic, so `fetchBaseQuery` + `prepareHeaders` had to be rewritten as `src/common/state/ApiClient.ts` (~230 lines: URL and params, JSON/FormData bodies, bearer token, empty-body handling, `FETCH_ERROR` / `PARSING_ERROR` / HTTP status mapping).

This is now our code to own. Writing its spec found a real bug: a parse failure on a _successful_ response was swallowed and returned `null` instead of `PARSING_ERROR`. It is fixed and covered by `ApiClient.spec.ts`.

### 2.2 [gap] No Promise-based mutation API

The client API is Effect-only; per the library's own design decision there is no `mutateAsync`.
Forms (if the project is not already using @lucas-barake/effect-form) and `try { await trigger(x).unwrap() }` flows need a Promise, and getting one needs the app runtime. `QueryClientProvider` accepts a runtime but offers no hook to read it back.

- **App code:** `useRunPromise()` in `AppStateProvider.tsx`, and `settleMutation()` (an `Effect.match` to `{ data } | { error }`) so RTK-style outcome handling keeps working.
- **Effect:** `runPromise(mutation.mutateEffect(x).pipe(Effect.match(...)))` is much more ceremony than `.unwrap()`. A conditional `mode === "edit" ? update.mutateEffect(x) : create.mutateEffect(x)` does not type-check with `useRunPromise` (union of Effects), so each branch needs its own call.
- **Limitation:** `useRunPromise` is typed for `R = ApiClient`, so `QueryClient.use(...)` Effects must go through `useQueryClient().fetchQuery(...)` instead.

### 2.3 [gap] No error transform

RTK's `transformErrorResponse` (used by the audit and stakeholder slices to turn errors into strings) has no equivalent. Queries now keep `ApiError`, and mapping moved to consumers (`toStakeholderErrorString`, the audit result adapter).

### 2.4 [gap] Two persistence mechanisms and two schema libraries

`QueryPersister` persists only the query and mutation cache. Former Redux slices and `use-local-storage-state` values use `Atom.kvs` from `effect/reactivity`, which is a different mechanism. Both require **Effect Schema**, while the app validates API data with **zod**, so the app now carries two schema libraries.

`Atom.kvs` also behaves differently from `use-local-storage-state`:

- **Default bound early:** the default value is fixed when the atom is defined. The old `useAppLocalStorageState(key, default)` passed it at call time, so the replacement needs an `Atom.family` with a mutable default holder, and the first default ever passed for a key wins.
- **Write on read:** on first read of a missing key it writes the default to storage.
- **No cross-tab sync:** it ignores `storage` events, so changes in another tab no longer arrive. That is a behaviour regression, accepted for this app.
- **Stale after removal:** it does not notice an external `localStorage.removeItem`, so the in-memory value goes stale.

### 2.5 [gap] No test helpers

These were all built in-house: `makeTestAppState` (fake routes plus call recording), the Effect-runtime test wiring, a notification recorder, and a fake mutation hook (`src/features/organisation/organisationTestUtils.ts`). Specific gaps:

- **Results:** no factory for the result object `useQuery` returns. `QueryResult.success(...)` builds a bare `QueryResult`, which needs a cast to stand in for the hook result. There is no "idle" constructor, and `QueryResult.disabled` needs an `AsyncResult` argument.
- **Responses:** fake responses resolve synchronously and cannot stay pending, so loading states can only be tested by mocking `useQuery`. One `useSenderMessageTypes` test case ("None before the query succeeds") was dropped.
- **Mocking:** RTK generated one hook per endpoint, which could be spied on individually. Now one generic `useQuery` / `useMutation` must be mocked with a dispatcher keyed on atom identity, which needs a dynamic `await import()` inside `vi.mock`.

## 3. Types

- **[types] `useQuery` infers `B` from the return context.** In `useQuery<A, E, R, B = A>`, nesting the call inside another generic, e.g. `makeComponentStatus(toLegacyQueryResult(useQuery(q)))`, makes TypeScript infer `B` as `undefined` or `A | undefined`. The resulting error appears far from the cause, in JSX props. The workaround is to hoist `const r = useQuery(q)`; about 10 containers needed it. Upstream fix: infer `B` only from `select` (an overload without `select`, or `NoInfer` on the return).
- **[types] `QueryKey` is a non-empty tuple** (`readonly [string, ...unknown[]]`). Shared key constants built with spreads widen to `string[]`. `Query.make({ key })` and `invalidates` then fail with "No overload matches this call" or a long error full of branded zod types. Every key constant needs `as const`. A `QueryKey.make(...)` helper or a docs note would help.
- **[types] `skipToken` doesn't apply to argument-less queries.** `Query.single` queries cannot be skipped with `Query.skipToken`; `{ enabled: false }` is needed instead. Fine, but it is a second mechanism and isn't documented next to `skipToken`.

## 4. Undocumented behaviour

- **[docs] `staleTime: "static"` ignores invalidation.** It looks like the natural mapping of RTK Query's "cached until invalidated", but static queries are skipped by invalidation and refetch, which only the type comments mention. The app uses `staleTime: "Infinity"` instead.
- **[docs] `QueryClientProvider` also provides `RegistryContext`.** Passing `registry` to it makes the `@effect/atom-react` hooks work, which is only visible in `dist/index.mjs`. The first attempt double-wrapped the provider.
- **[docs] `mutateEffect` updates hook state.** It does update the component's `isPending` / `isError`, as `mutate` does, so `isDeleting={m.isPending}` keeps working. The `.d.mts` doc doesn't say so; it was confirmed by reading the source.
- **[docs] Structural sharing is unverified.** RTK's custom `merge` / `serializeQueryArgs` / `forceRefetch` in the audit slice were dropped in favour of structural sharing. We did not verify that deep-equal refetched data keeps the same reference.

## 5. Behaviour differences from Redux (real bugs found)

These are **[migration]** pitfalls. Each would have shipped as a bug without the ported tests.

1. **Infinite render loop.** Immer returned the same state reference for a no-op update, so `useSelector` did not re-render. Atoms compare with `Object.is`, and the `apply*` transitions always return new objects. `DeepLinkHandler` writes state in an effect that depends on that state, which caused "Maximum update depth exceeded". Fixed by making `persistedAtom` compare with `Equal.equals`, plus `Atom.withEquality` on the deep link atom. Any atom written from an effect that reads it has the same risk.
2. **Persisted state wiped at login.** Persisted atoms now live under the app's `app_1_0_0_` prefix, and `clearAppLocalStorageState` (run on login callback) removes every key with that prefix. The deep link and the multi-step form progress were lost on every login. Fixed by giving persisted client state atoms their own prefix, `app_state_1_0_0_` (`STATE_PREFIX` in `persistedAtom.ts`), which the login clear does not match; `useAppLocalStorageState` UI state stays under `app_1_0_0_` and is still cleared.
3. **Empty error alerts.** `ApiError` is a `Data.TaggedError`, so it has a `message` of `""`. `extractErrorMessage` prefers `error.message` over its JSON fallback, so the password-reset failure alert would have been empty. RTK's error object had no `message`. The same empty string reached views through `getErrorMessage` for every query error passed on by the legacy result adapter (RTK showed "unknown error" there). Fixed by giving `ApiError` a derived `message` getter (`makeApiErrorMessage`): the server's `message` / `messages` for an HTTP error, otherwise "Request failed with status N", "Request could not be sent (…)" or "Response could not be parsed". A getter is needed because `Data.TaggedError` has no constructor hook for `message`.
4. **Base URL read lazily.** The RTK slices computed the base URL at import time; the `ApiClient` layer reads `window.location` when the provider mounts. `ClientUsefulLinks.spec.tsx` replaced `window` with a spread copy (dropping `location`) and broke. Fixed in the spec.
5. **Persisted keys renamed.** `redux_localstorage_simple_*` became `app_state_1_0_0_*`, and old keys are not migrated, so users lose in-flight stepper or deep link state once after deploy.
6. **Dead RTK config not carried over.** `refetchOnFocus` / `refetchOnReconnect` were set in four slices but never active, because `setupListeners` was never called. They were deliberately not mapped to the library's focus and reconnect refetch, which would have changed behaviour.

## 6. App-side friction

- **Old helpers expect RTK results.** `makeComponentStatus`, `getQueryResultData` and `domain/general.ts` `QueryResult` expect RTK-shaped results (`data?: T`, `isLoading`). The library returns `data: Option<A>`, and passing it directly would give `Success(Option.none())`. Three agents each wrote the same adapter during the migration; they are now merged into `src/common/state/queryResult.ts` (`toLegacyQueryResult`, with an optional error mapper for the audit queries, `toLegacyMutationResult` and `settleMutation`).
- **Unvalidated endpoints need a cast.** `apiRequest` returns `Effect<unknown>`, while RTK typed some endpoints through generics without validation. Those now need `unvalidated<T>` casts, or zod schemas.
- **Auth config in every component test.** `ApiClient` imports the auth utilities, so a partial `vi.mock` of `configUtils` broke `OrganizationManagementPage.spec.tsx`.
- **Shared localStorage across tests.** Persisted atoms use one module-level localStorage runtime, so tests share jsdom `localStorage` even with a fresh registry. Specs that touch persisted atoms need `localStorage.clear()`, and no in-memory `KeyValueStore` can be injected per test.
- **Lint vs Effect naming.** `ApiClient.use(...)` trips `react-hooks/rules-of-hooks` because the name starts with `use`, so it was rewritten with `Effect.gen`.
- **Migration ordering.** `testUtils.tsx` imported the Redux store, so deleting any slice broke every spec in the repo at import time, including pure View specs. Feature areas could only be verified with a temporary store stub. On a real migration, remove the Provider from the test utilities first.

## 7. What worked well

- **Test layers:** swapping `ApiClient` with a `Layer` in tests is much simpler than RTK's `setupApiStore` plus global `fetch` mocks. Query specs (`appState.run(QueryClient.use(c => c.fetchQuery(q)))`) are short and assert caching and invalidation directly.
- **Endpoint mapping:** `invalidates: () => [...]` on mutations maps RTK's `invalidatesTags` and cross-API invalidation cleanly. Typed keys (`query.key(arg)`), `getQueryData` returning `Option`, family memoisation and `skipToken` all worked as expected. Infinite queries covered the submissions table.
- **Client state:** atoms with pure `apply*` transitions kept the old reducer tests nearly unchanged. `registry.set(atom, fixture)` replaces `preloadedState`, and asserting `registry.get(atom)` replaces dispatch spies.
- **Install:** peer dependencies matched the project exactly, so no overrides were needed.

## 8. Recommendations

**Upstream (effect-atom-query):**

1. Guard the deferred unbind against a disposed registry (1.1).
2. Make `useQuery` infer `B` only from `select` (section 3).
3. Ship test helpers: a hook-result factory with an idle state, and a test client with deferred or pending responses (2.5).
4. Expose the provider runtime (`useQueryRuntime` / `useRunPromise`), or offer an optional Promise API for mutations (2.2).
5. Document: `"static"` vs invalidation, `mutateEffect` updating hook state, the provider supplying `RegistryContext`, `as const` keys and `enabled` vs `skipToken`.

**In this app, before merging this branch:**

1. ~~Merge the three result adapters into `src/common/state`~~ (done). Longer term, make `makeComponentStatus` accept library results so the adapter can go.
2. ~~Give `ApiError` a useful `message`~~ (done). The fallback texts are English and not translated; decide whether views should map them to i18n keys.
3. ~~Move persisted atoms to their own sub-prefix instead of `PRESERVED_KEYS`~~ (done: `STATE_PREFIX`).
4. ~~Decide whether losing cross-tab sync for `useAppLocalStorageState` is acceptable~~ (accepted, see `decisions.md`).
5. Smoke-test against `tst`. (Comparing bundle size with `develop` is skipped for now.)
6. Decide on adoption (deferred), given the package's age (all versions published in one day, single maintainer) and the `minimum-release-age` npm setting being ignored by npm 12. That setting would have blocked installing a release less than a day old.
