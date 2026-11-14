# effect-native-query — Plan

> A TanStack Query–style server-state library for React, written as idiomatic
> Effect: typed errors, services and layers, `Schedule`-based retries, fiber
> interruption as cancellation, and Effect Atoms (`effect/reactivity`) as the
> reactive cache.

Status: **v1.0 scope complete, 2026-11-13. Phases 1–6 done; phase 7 done except SSR (2026-11-14)**; see §8 for implementation notes. Decisions D1–D4 are settled and the
remaining open questions are in [QUESTIONS.md](./QUESTIONS.md). The TanStack-to-Effect feature mapping is in
[FEATURE-MATRIX.md](./FEATURE-MATRIX.md).

---

## 1. Goals and non-goals

### Goals

1. **Behavioural parity** with TanStack Query v5's
   [important defaults](https://tanstack.com/query/latest/docs/framework/react/guides/important-defaults),
   meaning stale-while-revalidate, refetch on mount/focus/reconnect, gc of
   inactive queries, retries with backoff, structural sharing and request
   deduplication.
2. **Idiomatic Effect throughout.**
   - Query functions are `Effect<A, E, R>`, not `Promise`s.
   - `E` is preserved end to end, so `error` is typed, not `unknown`.
   - `R` is satisfied by a `Layer` given to the client runtime, so queries can depend on `HttpClient`, repositories, auth and so on.
   - Retries are `Schedule`s, cancellation is fiber interruption, and timers use `Clock`, which makes them testable with `TestClock`.
3. **Atoms as the cache substrate.** Each query entry is an Effect Atom living in
   an `AtomRegistry`. React subscribes through `@effect/atom-react`. We build on
   what atoms already provide and do not re-implement it:
   - `Atom.family` for keyed instances
   - `Atom.setIdleTTL` for gcTime
   - `Atom.swr` for staleTime and revalidate-on-mount/focus
   - `Atom.refreshOnWindowFocus` and `Atom.makeRefreshOnSignal`
   - `Reactivity` keys for invalidation
   - `Atom.fn` for mutations
   - `Atom.optimistic` and `Atom.optimisticFn`
   - `Atom.pull` for infinite queries
   - `Atom.serializable` (with `Schema`) for persistence, and later `Hydration` for SSR
   - `useAtomSuspense` for Suspense
4. **No `undefined` in the public API (D2).** Absent values are `Option`.
   This covers `data`, `error`, `failureReason`, `getQueryData`,
   `pageParam`s and so on.
5. **Effect-only imperative API (D4).** Every `QueryClient` method returns an
   `Effect`. There is no Promise or sync facade. React code that has to run
   one (for example in an event handler) uses `useQueryClientRuntime()` or a
   hook-provided runner.
6. **A familiar React surface.** Hook names and semantics should feel like
   TanStack's (`useQuery`, `useMutation`, `useInfiniteQuery`,
   `useSuspenseQuery`, `useIsFetching`, …) so migrating is mostly mechanical.
7. **Deterministic tests.** Every timing-related default (stale, gc, retry,
   polling) is covered by `@effect/vitest` and `TestClock`, with no real timers.

### Non-goals (v1)

- **SSR / hydration** is post-v1 (D3). Persistence already needs Schema-based
  serialisation, so adding hydration later costs little.
- A Promise-based imperative client API (D4).
- Framework adapters other than React (Vue, Solid, Svelte). The core stays
  framework-agnostic so they remain possible later.
- A full devtools UI. A minimal inspector is a stretch goal.
- Byte-for-byte TanStack API compatibility. We match **behaviour** and naming,
  but we prefer Effect-native types (`Duration`, `Schedule`, `Option`,
  `AsyncResult`) over primitives.

---

## 2. Toolchain (already scaffolded)

| Concern         | Choice                                                                                       |
| --------------- | -------------------------------------------------------------------------------------------- |
| Toolchain       | **Vite+ 1.6** (`vp`): dev, build, pack (tsdown), test (Vitest 5), lint (oxlint), fmt (oxfmt) |
| Language        | **TypeScript 7.0.2** (native/Go compiler; d.ts emitted via `tsgo`)                           |
| Effect          | **effect 4.1.4**, atoms from `effect/reactivity`                                             |
| React bindings  | **@effect/atom-react 4.1.4**, React 19.3                                                     |
| Testing         | `@effect/vitest`, `@testing-library/react`, `happy-dom`                                      |
| Package manager | pnpm 12 workspaces with a catalog in `pnpm-workspace.yaml`                                   |

Layout:

```
packages/
  query/      @effect-native-query/query   framework-agnostic core (Effect + atoms)
  react/      @effect-native-query/react   React hooks, provider, boundaries
apps/
  playground/ Vite+ React app for manual testing and examples
docs/         this plan
```

During development, workspace packages resolve to their TypeScript sources
through the custom export condition `@effect-native-query/source`, which is set
in `tsconfig.base.json` (`customConditions`) and in each Vite config
(`resolve.conditions`). Published builds use `dist/`.

Commands: `vp check` (fmt, lint, types), `vp run -r test`, `vp run -r build`,
`vp run dev` (playground).

---

## 3. Architecture

```
┌──────────────────────────── React (@effect-native-query/react) ───────────────────────────┐
│ QueryClientProvider ─ RegistryProvider   useQuery / useSuspenseQuery / useQueries         │
│ useMutation / useMutationState / useIsFetching / useIsMutating / useInfiniteQuery         │
│ HydrationBoundary   QueryErrorResetBoundary   usePrefetchQuery                            │
└───────────────┬───────────────────────────────────────────────────────────────────────────┘
                │ useAtomValue / useAtomSet / useAtomSuspense / useAtomMount
┌───────────────▼──────────────────── Core (@effect-native-query/query) ────────────────────┐
│ Query.make(def) ──► Atom.family(key ⇒ entry atom)                                         │
│   entry atom = runtime.atom(fetchEffect)                                                  │
│                ▸ swr(staleTime) ▸ setIdleTTL(gcTime) ▸ refresh-on-signals ▸ reactivity     │
│ Mutation.make(def) ──► runtime.fn(mutationEffect) ▸ Reactivity.mutation(keys)             │
│ InfiniteQuery.make(def) ──► pages atom (Atom.pull or custom page reducer)                 │
│                                                                                           │
│ QueryClient (Context.Service)                                                             │
│   ├─ QueryCache: MutableHashMap<QueryKey, QueryEntry>  (observers, state, fetch fiber)    │
│   ├─ MutationCache                                                                         │
│   ├─ defaults (staleTime, gcTime, retry Schedule, networkMode, …)                         │
│   └─ imperative API as Effects: invalidate / refetch / cancel / reset / remove /           │
│      setQueryData / getQueryData / fetchQuery / prefetch / ensureQueryData               │
│                                                                                           │
│ FocusManager (service, Atom signal)   OnlineManager (service, Atom signal + latch)        │
└───────────────────────────────────────────────────────────────────────────────────────────┘
```

### 3.1 Query keys

- A `QueryKey` is a readonly tuple: `readonly [string, ...unknown[]]`.
- Identity uses **Effect `Equal`/`Hash`**. Plain objects and arrays inside keys
  are compared structurally, through a `QueryKey.make` normaliser that converts
  them to `Data` structures with sorted object keys, which matches TanStack's
  stable hashing. `Schema.Class` / `Data.Class` instances can be used directly.
- **Partial matching** for filters: key `['todos']` matches
  `['todos', {page: 1}]`. `exact: true` disables prefix matching.
- Typed key factories (recommended pattern):
  `const todoKeys = QueryKey.factory('todos', { list: (f: Filters) => [f], detail: (id: TodoId) => [id] })`.

### 3.2 Query definitions

```ts
// D1: atom-first. Queries are module-level families; hooks take the atom.
export const todoQuery = Query.make({
  key: (id: TodoId) => ["todos", id],
  run: (id) => TodoRepo.pipe(Effect.flatMap((r) => r.get(id))), // Effect<Todo, TodoNotFound | HttpError, TodoRepo>
  staleTime: Duration.seconds(30),
  // optional: gcTime, retry: Schedule, select, placeholder, initialData, networkMode, refetchInterval, …
});
```

`Query.make` returns a `QueryFamily<Arg, A, E>`:

- `todoQuery(id)` gives an `Atom<QueryResult<A, E>>`, memoised by `Atom.family`
  through the normalised key.
- `todoQuery.key(id)` gives the `QueryKey`, used for filters and `setQueryData`.
- `todoQuery.options` carries the static options, usable in the spirit of
  `queryOptions()`.

**Thin compat layer (D1):** `queryOptions({ key, run, ... })` is an alias for
`Query.make` applied to a single key (`Query.single`), which helps when
porting TanStack code. Inline `useQuery({ queryKey, queryFn })` is **not**
supported.

`R` is resolved by the **client runtime** (`Atom.runtime(layer)`), which the
user creates once: `QueryClient.layer({ defaults })` merged with app layers.

### 3.3 Query entry lifecycle (state machine)

Each entry stores:

- `AsyncResult<A, E>`, Effect's equivalent of `status`, with `waiting` serving as `fetchStatus`
- `dataUpdatedAt`, `errorUpdatedAt`, `failureCount`, `failureReason`
- `isInvalidated`
- `fetchStatus: 'idle' | 'fetching' | 'paused'`
- the in-flight `Fiber`, which provides deduplication: concurrent fetches join the same fiber

Transitions:

| Trigger                               | Behaviour                                                                           |
| ------------------------------------- | ----------------------------------------------------------------------------------- |
| first observer mounts                 | fetch if no data, or if stale and `refetchOnMount` (default `true`)                 |
| window focus (FocusManager signal)    | refetch active, stale queries (`refetchOnWindowFocus`, default `true`)              |
| reconnect (OnlineManager signal)      | refetch active, stale queries (`refetchOnReconnect`, default `true`)                |
| `invalidate(filter)` / Reactivity key | mark invalidated; refetch active matches (`refetchType: 'active'`)                  |
| `refetchInterval`                     | `Schedule.spaced`, paused in the background unless `…InBackground`                  |
| last observer unmounts                | start the gcTime idle TTL (default 5 min, via `Atom.setIdleTTL`); dispose on expiry |
| failure                               | retry via `Schedule` (default 3 retries, exponential backoff capped at 30 s)        |
| offline and `networkMode: 'online'`   | fetch fiber waits on an online `Latch`, and `fetchStatus` becomes `paused`          |
| `cancel(filter)`                      | `Fiber.interrupt`; revert to the previous state (`revert: true`)                    |

Cancellation is free: interrupting the fiber aborts `HttpClient` requests
through their internal `AbortSignal`. Users who call `fetch` directly can use
`Effect.tryPromise({ try: (signal) => fetch(url, { signal }) })`.

### 3.4 Result shape

The core atom value is a `QueryResult<A, E>`, a thin projection over
`AsyncResult` with TanStack-style derived fields. **D2:** we keep the TanStack
flags but never use `undefined`. Absent values are `Option`. The result is a
discriminated union on `status`, so narrowing refines the `Option`s:

```ts
interface QueryResult<A, E> {
  readonly result: AsyncResult<A, E>    // the source of truth; pattern-match with AsyncResult.builder
  readonly status: "pending" | "error" | "success"
  readonly fetchStatus: "fetching" | "paused" | "idle"
  readonly data: Option<A>
  readonly error: Option<E>             // typed E; defects/interrupts are a separate channel
  readonly isPending / isSuccess / isError / isFetching / isLoading / isRefetching / isPaused
  readonly isStale / isPlaceholderData / isFetched / isFetchedAfterMount
  readonly dataUpdatedAt: Option<DateTime.Utc>
  readonly errorUpdatedAt: Option<DateTime.Utc>
  readonly failureCount: number
  readonly failureReason: Option<E>
}

// narrowing via status / isSuccess:
//   success → data: Option.Some<A>     (use `r.data.value`)
//   error   → error: Option.Some<E>,  data: Option<A>  (stale data may still be present)
//   pending → data: Option.None (unless placeholder), error: Option.None
// useSuspenseQuery / initialData variants → data: A (always present, so not an Option)
```

Defects (`Cause.Die`) are **not** mixed into `error`. By default they are
rethrown to the nearest React error boundary, because an unexpected bug should
not look like a handled `E`.

### 3.5 Structural sharing and `select`

- Default: when new data is `Equal.equals` to the old data, keep the old reference.
- JSON-like data: port TanStack's `replaceEqualDeep`, so unchanged subtrees keep
  their references. This can be turned off with `structuralSharing: false` or
  replaced with a custom function.
- `select` runs in a derived `Atom.map` per observer. It does not affect the
  cache, and it is memoised on the selector reference.
- **Render optimisation:** TanStack tracks which props a component reads.
  We get the same effect with field-level derived atoms (`useQuery(q, { select })`)
  plus `Atom.withEquality`. A Proxy-based tracked result is an optional stretch
  goal.

### 3.6 FocusManager and OnlineManager

These are Effect services with a default browser `Layer`:

- FocusManager listens to `visibilitychange` and reuses `Atom.windowFocusSignal`.
- OnlineManager listens to `online`/`offline` and exposes an atom plus a `Latch`.

Both can be overridden (React Native, tests) through `setFocused` /
`setOnline`, or by providing a different layer.

### 3.7 Mutations

```ts
const addTodo = Mutation.make({
  key: ["todos", "add"],                   // optional, used by useMutationState / useIsMutating
  run: (input: NewTodo) => TodoRepo.add(input),
  invalidates: (input, result) => [todoKeys.all], // integrates with Reactivity and QueryClient.invalidate
  onMutate / onSuccess / onError / onSettled,     // each is an Effect, so they can use services
  retry: Schedule, // default: no retry
  scope: "todos",  // same scope id runs serially (Semaphore(1) per scope)
})
```

- Built on `runtime.fn`, so its state is an `AsyncResult` atom.
- `useMutation` returns:
  - `mutate(input, callbacks?)`, fire and forget, run on the client runtime
  - `mutateEffect(input)`, an `Effect<A, E>` for composition. Per D4 there is
    no `mutateAsync` Promise.
  - `reset` and the state fields
- **Optimistic updates**, two styles:
  1. Cache style: `onMutate` calls `client.cancel` and `client.setQueryData`, and returns a snapshot that `onError` rolls back (TanStack parity).
  2. Atom style: `Atom.optimistic` / `Atom.optimisticFn`, which roll back automatically.
- The MutationCache tracks every mutation, for `useMutationState`, `useIsMutating`
  and `resumePausedMutations` (offline).

### 3.8 Infinite queries

`InfiniteQuery.make({ key, run: (pageParam) => Effect, initialPageParam, getNextPageParam, getPreviousPageParam?, maxPages? })`

- The value is `{ pages: A[], pageParams: P[] }` plus `hasNextPage`,
  `fetchNextPage`, `fetchPreviousPage`, `isFetchingNextPage`, and so on.
- On refetch, pages are re-fetched **sequentially** from the first, as in
  TanStack. This is why we probably cannot use `Atom.pull` as-is; prototype in
  phase 5.

### 3.9 Persistence and offline (v1), SSR (post-v1)

**Persistence (v1, phase 6):**

- A `persistQueryClient` equivalent: a `QueryPersister` service backed by
  `KeyValueStore`, with layers for localStorage, sessionStorage and IndexedDB.
- Options: `buster` (cache version), `maxAge` (default 24 h; requires
  `gcTime >= maxAge`), throttled writes (`Schedule`), and a
  `dehydrateOptions.shouldDehydrateQuery` filter.
- Each persisted query declares `schema: { data: Schema<A>, error?: Schema<E> }`.
  This uses `Atom.serializable`, so a restored value is decoded and type-safe.
  Queries without a schema are not persisted, and the type system enforces it.
- `useIsRestoring` / `IsRestoringProvider`: while the cache is restoring,
  queries hold `fetchStatus: 'idle'` and Suspense hooks suspend.
- **Offline mutations:** paused mutations (`networkMode: 'online'` while
  offline) are persisted with their input, which needs a Schema, and the
  mutation `key`. `resumePausedMutations` replays them on reconnect. Replay
  uses `setMutationDefaults(key, { run })`, because functions cannot be
  persisted.

**SSR / hydration (post-v1):** `dehydrate` and `hydrate` on
`effect/reactivity/Hydration`, the atom-react `HydrationBoundary`, and server
defaults (`gcTime: Infinity`, `retry: 0`). These reuse the same Schemas.

---

## 4. React package surface

| Hook / component                                            | Built on                                                                               |
| ----------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| `QueryClientProvider` (`client`, optional `layer`)          | `RegistryProvider` + context holding the client                                        |
| `useQueryClient()`                                          | context                                                                                |
| `useQuery(query, options?)`                                 | `useAtomValue(query(arg))` + mount/observer bookkeeping                                |
| `useSuspenseQuery`                                          | `useAtomSuspense`; `data: A` is non-optional                                           |
| `useQueries({ queries, combine })` / `useSuspenseQueries`   | array of atoms → combined derived atom                                                 |
| `useInfiniteQuery` / `useSuspenseInfiniteQuery`             | InfiniteQuery atoms                                                                    |
| `useMutation`                                               | `useAtomSet(mutation, { mode: "promise" })` + state atom                               |
| `useMutationState({ filters, select })`                     | MutationCache atom                                                                     |
| `useIsFetching(filters?)` / `useIsMutating(filters?)`       | derived count atoms on the caches                                                      |
| `usePrefetchQuery` / `usePrefetchInfiniteQuery`             | `registry.mount` during render                                                         |
| `QueryErrorResetBoundary` / `useQueryErrorResetBoundary`    | resets errored queries on boundary retry                                               |
| `HydrationBoundary` (post-v1)                               | `@effect/atom-react` HydrationBoundary                                                 |
| `useIsRestoring` / `IsRestoringProvider`                    | persistence restore flag                                                               |
| `skipToken` / `enabled`                                     | a disabled query atom that never runs                                                  |
| `queryOptions` / `infiniteQueryOptions` / `mutationOptions` | thin compat aliases for `Query.single` / `InfiniteQuery.single` / `Mutation.make` (D1) |

---

## 5. Milestones

Each phase ends with green `vp check` and `vp run -r test`, plus a playground page.

| #   | Phase                             | Deliverables                                                                                                                                                                                                                                                    |
| --- | --------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 0   | **Scaffold** ✅                   | Vite+ monorepo, TS 7, Effect 4.1.4, atom-react, smoke tests, playground                                                                                                                                                                                         |
| 1   | **Core query** ✅                 | `QueryKey` (normalise, hash, partial match), `QueryClient` service and layer, `QueryCache`, `Query.make`, fetch dedup, `AsyncResult` to `QueryResult` projection, staleTime, gcTime, retry Schedule, `enabled`/`skipToken`, `TestClock` tests for every default |
| 2   | **React basics** ✅               | `QueryClientProvider`, `useQueryClient`, `useQuery`, `useQueries`, `useIsFetching`, `select`, `placeholderData` (incl. `keepPreviousData`), `initialData`, structural sharing (`replaceEqualDeep`), StrictMode safety                                           |
| 3   | **Triggers** ✅                   | FocusManager, OnlineManager, `networkMode` (online/always/offlineFirst), refetchOnMount/Focus/Reconnect, `refetchInterval`, cancellation via `cancel` with revert                                                                                               |
| 4   | **Mutations and invalidation** ✅ | `Mutation.make`, `useMutation`, `invalidate`/`refetch`/`reset`/`remove`/`setQueryData`/`setQueriesData`, Reactivity integration, optimistic updates (both styles), `useMutationState`, `useIsMutating`, mutation `scope`                                        |
| 5   | **Suspense and infinite** ✅      | `useSuspenseQuery`/`Queries`/`InfiniteQuery`, `QueryErrorResetBoundary`, `useInfiniteQuery` with sequential refetch and `maxPages`, `usePrefetchQuery`                                                                                                          |
| 6   | **Persistence and offline** ✅    | Schema-based `QueryPersister` (KeyValueStore: localStorage/IndexedDB), `buster`/`maxAge`, `useIsRestoring`, paused-mutation persistence and `resumePausedMutations`                                                                                             |
| —   | **v1.0 release**                  | phases 1–6                                                                                                                                                                                                                                                      |
| 7   | **Post-v1** ✅ (except SSR)       | SSR (dehydrate/hydrate, `HydrationBoundary`, server defaults), tracked-props optimisation, docs site, playground examples matching the TanStack examples, bundle-size budget, optional devtools inspector                                                       |

---

## 6. Testing strategy

- **Core:** `it.effect` with `TestClock.adjust` for stale, gc, retry and
  interval behaviour. A fake `FocusManager`/`OnlineManager` layer drives focus
  and online events.
- **React:** `@testing-library/react` in happy-dom, rendering inside
  `QueryClientProvider` with a test layer. Each test checks render counts to
  catch over-rendering.
- **Conformance suite:** port the relevant TanStack `query-core` and
  `react-query` test cases as behavioural specs, adapted to Effect APIs.
  Track parity in FEATURE-MATRIX.md.
- **Type tests:** `expectTypeOf` for `E` and `R` inference, data narrowing after
  `isSuccess`, and non-optional `data` for Suspense and `initialData`.

## 7. Risks

| Risk                                                                                    | Mitigation                                                                                                     |
| --------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| `effect/reactivity` is marked `@stability unstable`; APIs may shift in 4.x minors       | Pin via the catalog, isolate atom usage behind internal modules, add an upgrade checklist                      |
| TS 7 API is experimental (tsdown warns); some tooling (language-service plugin) may lag | `vp check` uses tsgolint; fall back to `typescript@5.9` for d.ts emit only if needed                           |
| Imperative cache (filters, `setQueryData`) vs. atom family identity                     | QueryCache is the single index (key to entry); atoms are views, so filters iterate the cache, not the registry |
| Infinite-query refetch semantics don't map to `Atom.pull`                               | Custom page reducer atom; prototype early in phase 5                                                           |
| StrictMode double-mount creating duplicate fetches                                      | Fiber deduplication per entry, observer refcount in `QueryCache`                                               |

---

## 8. Implementation notes

### Phase 1: core query

What exists in `packages/query/src`:

| Module                   | Contents                                                                                                                                                                                                                                                                       |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `QueryKey.ts`            | `QueryKey`, `Tagged<A, E>` (type-only brand so `getQueryData(todo.key(1))` is typed), `equals`, `matches` (TanStack partial matching)                                                                                                                                          |
| `QueryResult.ts`         | `QueryResult<A, E>` = `Pending`, `Success` or `Failure`, discriminated on `status`; `Option`s everywhere (D2); `result: AsyncResult`; `match`, `isDefect`                                                                                                                      |
| `Query.ts`               | `Query.make({ key, run, ...options })` returns a memoised family; `Query.single` / `queryOptions`; `skipToken`; `isQueryAtom`                                                                                                                                                  |
| `QueryClient.ts`         | `QueryClient` service; `make` (scoped), `layer`, `layerRegistry`; `current` / `initialValue` / `fromAtomContext` bind a client to an `AtomRegistry`; `fetchQuery`, `prefetchQuery`, `ensureQueryData`, `getQueryData`, `getQueryState`, `isFetching`, `removeQueries`, `clear` |
| `internal/queryEntry.ts` | per-key state machine: observers, fetch fiber (deduplicated), retry via `Schedule` (with `failureCount` / `failureReason`), stale timer, gc timer                                                                                                                              |
| `internal/queryCache.ts` | `MutableHashMap<QueryKey, QueryEntry>`, `QueryFilters`, `matchQuery`                                                                                                                                                                                                           |

Decisions made while building it:

- **Keys use Effect `Equal`/`Hash` directly.** In Effect 4, `Equal.equals` is
  structural for plain objects and arrays, so no normalisation step is needed.
  `Atom.family` memoises query atoms on the same structural equality.
- **The cache is plain Effect and the atoms are views.** Each `QueryEntry`
  holds mutable state and listeners. A query atom (`Atom.readable`) does three
  things while it is built: it registers an observer (fetch-on-mount, blocking
  gc), subscribes to the entry and calls `setSelf` on changes, and releases
  both in a finalizer. `registry.refresh(atom)` calls the atom's refresh hook,
  which forces a refetch with `cancelRefetch`. If the entry is removed while
  the atom is mounted, the atom rebuilds against a fresh entry.
- **Binding a client to a registry.** `QueryClient.current` is a keep-alive
  `Atom<Option<QueryClient>>` that is set through registry initial values.
  Reading a query atom without a bound client throws `MissingQueryClientError`.
- **Services (`R`).** The client captures its construction context, so
  atom-triggered fetches use the services of the layer the client was built
  in. `fetchQuery` and friends merge in the caller's context, which keeps
  `R` checked statically on the Effect API. Atoms cannot check `R`
  statically: a missing service is a defect at runtime. A later option is a
  TanStack-style `Register` interface that declares the app's services
  globally.
- **Timers use `Clock`.** Stale and gc timers and retry delays are fibers on
  the client's context, so tests drive them with `TestClock`.
  `packages/query/test/Query.test.ts` covers every default with no real waits.
- **Defects are not retried.** `Effect.retry` only retries typed failures. A
  defect settles immediately as `status: "error"` with `error: None`, and
  `QueryResult.isDefect` is true.
- `staleTime: "static"` never goes stale and ignores `refetchOnMount: "always"`.
  Invalidation semantics arrive with phase 4.

### Phase 2: React basics

New in core:

| Module                          | Contents                                                                                                                                                                                                     |
| ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `QueryObserver.ts`              | `QueryObserver` (one per component): per-observer `enabled` / `refetchOnMount` / `select` / `placeholderData`, `isFetchedAfterMount`, optimistic first-render result, `refetch`; `QueriesObserver` for lists |
| `internal/structuralSharing.ts` | port of TanStack's `replaceEqualDeep`                                                                                                                                                                        |
| `Query.ts`                      | `initialData` / `initialDataUpdatedAt`, `DefinedQueryAtom`, `DefinedQueryResult`, `keepPreviousData`, `isSkipped`                                                                                            |

`@effect-native-query/react`: `QueryClientProvider` (`client` or `runtime`
prop), `useQueryClient`, `useQuery`, `useQueries` (+ `queriesEntry` for typed
`select`), `useIsFetching`. It re-exports the core namespaces.

Decisions made while building it:

- **`useQuery` uses an observer, not `useAtomValue`.** A query atom is shared
  by everything that reads it, so it cannot carry per-component options or
  refetch on every component mount. The hook works like TanStack's:
  - A `QueryObserver` is created per component.
  - `useSyncExternalStore` subscribes to a version counter.
  - `setOptions` runs in an effect.
  - Render returns `getOptimisticResult`. On the first render it already
    shows `fetching`, so there is no idle-pending flash.

  Query atoms remain the input, and they also work directly through
  `useAtomValue` (one shared observer). `QueryClientProvider` binds the client
  to its `RegistryProvider` for this purpose.

- **`QueryClientProvider` does not own the client.** It accepts a client or a
  `ManagedRuntime` that provides `QueryClient` (resolved with `runSync`), and
  the caller disposes the runtime. The registry is keyed by client identity.
- **Structural sharing** is on by default: an `Equal.equals` check, then
  `replaceEqualDeep`. Results of `select` are shared too and memoised on the
  `(select, data)` reference pair.
- **Entries nobody observes are garbage collected from creation.** This covers
  entries built during a render that never commits.
- **Cache-wide notifications** (`cache.subscribe`, used by `useIsFetching`)
  are batched on a microtask, so they never fire during a render.
- **Errors in React:**
  - Defects are always thrown to the nearest error boundary, as `Cause.squash`.
  - Typed errors are thrown only with `throwOnError` (a boolean or a predicate).
  - Nothing is thrown while a fetch is still running.
- **Typing details:**
  - `QueryAtom.options` is typed `QueryOptions<any>`, so `E` stays
    covariant and heterogeneous query lists type-check.
  - `throwOnError` uses the bivariance trick for the same reason.
  - Hook options use `NoInfer`, so only the atom drives type inference.
  - `initialData` gives a `DefinedQueryAtom`, whose result has
    `data: Option.Some<A>`.
- **Tests:** 33 core tests and 17 React tests (happy-dom). The playground was
  also smoke-tested in headless Chromium: StrictMode, `keepPreviousData`
  across pages, the fetching indicator, and a typed error page, with no
  console warnings.

Not done yet, by plan: tracked-props render optimisation (phase 7), and
refetch on window focus or reconnect (phase 3).

### Phase 3: triggers, network mode, cancellation

New in core: `FocusManager` and `OnlineManager` are `Context.Reference`
services whose default is a shared browser-backed instance. Each has
`make({ setup, ... })`, a `layer`, and the Effect accessors `setFocused` /
`setOnline`. `QueryClient.cancelQueries(filters, { revert })` was also added.
The new query and observer options are `refetchOnWindowFocus`,
`refetchOnReconnect`, `refetchInterval`, `refetchIntervalInBackground`,
`networkMode` and `retryOnMount`.

Decisions made while building it:

- **The managers are services with defaults, not module globals.** The
  defaults reproduce TanStack's singletons: `visibilitychange` for focus, and
  `online`/`offline` events for connectivity, starting out online.
  - Tests and React Native provide their own instances through a layer.
  - The client reads both at construction and subscribes for its lifetime,
    like TanStack's `QueryClient.mount()`.
  - We use these services rather than `Atom.windowFocusSignal`, so the
    behaviour is configurable per client and testable.
- **Observers are records on the entry.** Each record carries its own mount,
  focus, reconnect and interval options. `QueryObserver.setOptions` updates
  its record in place. A trigger refetches when any enabled observer asks for
  it, and every refetch is deduplicated.
- **Polling** uses one timer fiber per observer, rescheduled after every fetch
  settles. A function `refetchInterval` is re-evaluated against the latest
  result. In the background the timer re-arms instead of fetching, unless
  `refetchIntervalInBackground` is set.
- **Network mode** wraps every attempt in a pause step:
  - `online` pauses before every attempt.
  - `offlineFirst` pauses only before retries.
  - `always` never pauses.

  The pause sets `fetchStatus: "paused"` and waits for the online signal
  through `Effect.callback`. The same fiber then continues, so reconnecting
  resumes the fetch rather than starting a new one. `isFetching` and
  `useIsFetching` count only `fetching`, not `paused`.

- **Cancellation** is fiber interruption. With `revert` (the default), the
  state goes back to its snapshot from before the fetch started. Callers
  joined through `fetchQuery` are interrupted. Fetches are **not** cancelled
  automatically when the last observer leaves; they finish and populate the
  cache. TanStack only cancels in that case when the `AbortSignal` was
  consumed, and with Effect we cannot tell.
- **Tests:** 50 core tests (`TestClock`, a fresh manager per test) and 20
  React tests, including real `visibilitychange` / `online` / `offline`
  events in happy-dom. In headless Chromium the playground's 1-second clock
  polls, shows `paused` while the browser context is offline, and resumes on
  reconnect.

### Phase 4: mutations and invalidation

New in core:

| Module                                                   | Contents                                                                                                                                                                                                                                                            |
| -------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `Mutation.ts`                                            | `Mutation.make` returns a `MutationAtom`: a writable atom; write an input to run it, `Atom.Reset` to clear it. Also `Mutation.optimistic(query, mutation, apply)`                                                                                                   |
| `MutationResult.ts`                                      | `Idle \| Pending \| Success \| Failure`, using `Option`s and `result: AsyncResult`                                                                                                                                                                                  |
| `MutationObserver.ts`                                    | per-component state of the latest execution; `mutate`, `mutateEffect`, `reset`, plain UI callbacks                                                                                                                                                                  |
| `internal/mutationEntry.ts`, `internal/mutationCache.ts` | one entry per execution; callbacks, retry, offline pause, scopes (`Semaphore`), gc, `setMutationDefaults`                                                                                                                                                           |
| `QueryClient`                                            | `invalidateQueries` (`refetchType`), `refetchQueries`, `resetQueries`, `setQueryData` / `setQueriesData` (with `Option` updaters), `getQueriesData`, `setQueryDefaults` / `getQueryDefaults`, `setMutationDefaults` / `getMutationDefaults`, `mutate`, `isMutating` |

`@effect-native-query/react` adds `useMutation`, `useMutationState` and
`useIsMutating`.

Decisions made while building it:

- **Callbacks are Effects.** `onMutate`, `onSuccess`, `onError` and
  `onSettled` run inside the mutation's fiber with the client's services and
  the `QueryClient` itself, which the client adds to its own context. Cache
  work such as `cancelQueries`, `getQueryData` and `setQueryData` is
  therefore ordinary Effect code. Callbacks cannot fail (`E = never`); handle
  errors or let them become defects. `onError` receives the full `Cause`.
- **`invalidates`** is declarative: query keys to invalidate after success.
  The mutation stays `pending` until the active matching queries have
  refetched, so a UI never shows "saved" next to stale data. TanStack users
  get this by returning `invalidateQueries` from `onSettled`.
- **Two styles of optimistic update:**
  1. **Cache:** snapshot in `onMutate`, then restore it in `onError`.
  2. **UI:** `Mutation.optimistic(query, mutation, apply)` is a derived atom
     that folds every pending execution's `variables` over the query's data.
     Nothing is written to the cache, so nothing has to be rolled back.
     `useMutationState` covers the same need for lists.

  The draft plan also mentioned `Atom.optimistic`. It was dropped because
  query atoms are read-only views and `Mutation.optimistic` covers the use
  case.

- **Hook-level callbacks are UI callbacks.** The `onSuccess` and friends in
  `useMutation`, and the per-call callbacks of `mutate`, are plain functions.
  They run only for this component's latest execution, and only while it is
  mounted. Definition callbacks always run.
- **`mutateEffect` replaces `mutateAsync` (D4).** It runs with the caller's
  services, so `R` is checked. `mutate` is fire-and-forget on the client
  runtime.
- **Scopes:** executions with the same `scope` id run one at a time
  (`Semaphore(1)`). An execution waiting its turn shows `isPaused: true`,
  matching TanStack. `onMutate` runs immediately rather than queued, so
  optimistic updates appear at once.
- **Bridge to `Reactivity`.** If the client's context has Effect's
  `Reactivity` service:
  - Queries with `reactivityKeys` are invalidated, and refetched when active,
    on `Reactivity.invalidate(keys)`. This is what `Reactivity.mutation`,
    `AtomHttpApi` and `AtomRpc` mutations emit.
  - Mutations with `reactivityKeys` emit such an invalidation after success.
- **Typing:** `MutationAtom.options` is loosely typed, so atoms fit
  `MutationAtom<I, any, any, any, any>`. The typed `run` is exposed for `R`.
- **Cache-write details:**
  - `setQueryData(key)` on a key with no definition creates an entry whose
    `run` dies with a clear message, until a real query atom for that key
    attaches.
  - `invalidateQueries` and `refetchQueries` skip queries that are disabled,
    as TanStack's `isDisabled` defines it, and queries with `"static"`
    staleness.
- **Tests:** 65 core tests and 26 React tests. In headless Chromium, the
  playground todo list shows an optimistic row, settles after the
  invalidation refetch, clears its input through a UI callback, and shows a
  typed rejection whose overlay disappears. No console warnings.

### Phase 5: Suspense, error boundaries, infinite queries, prefetching

New in core:

- **`InfiniteQuery.ts`:**
  - `InfiniteQuery.make` / `infiniteQueryOptions`, producing an
    `InfiniteQueryAtom`, which is writable: write `"next"` or `"previous"`.
  - `InfiniteData { pages, pageParams }`, `nextPageParam` /
    `previousPageParam`, and `PagingState`.
- **`QueryObserver`:** gains a per-observer `staleTime`, `fetchOptimistic`
  (used by Suspense), `entryOf` and `fetchPage`.
- **`Query.makeAtom` (internal):** builds query atoms with a fetch
  `behavior` and an optional writer.

New in React: `useSuspenseQuery`, `useSuspenseQueries`, `useInfiniteQuery`,
`useSuspenseInfiniteQuery`, `QueryErrorResetBoundary` /
`useQueryErrorResetBoundary`, `usePrefetchQuery` and
`usePrefetchInfiniteQuery`. `useQuery` and `useQueries` now share one base
implementation with the Suspense variants.

Decisions made while building it:

- **Infinite queries are ordinary query atoms with a fetch behavior.** The
  entry calls the behavior with the current data and a direction:
  - **Forward / backward** fetches one page and appends or prepends it,
    respecting `maxPages`.
  - **No direction** (initial load or any refetch: invalidation, focus,
    `refresh`, polling) refetches every loaded page **in order**. It starts
    from the first page param and follows `getNextPageParam` of the _fresh_
    pages, as TanStack does.

  The entry stores the direction (`fetchDirection`), from which
  `isFetchingNextPage` and `isFetchNextPageError` are derived. Page params
  are `Option`s, with `None` meaning no more pages (D2).

- **Suspense:**
  - The hook throws a stable per-fetch promise. It is derived from the fetch
    fiber with `Fiber.await` and always resolves, so the re-render reads the
    error.
  - Suspense hooks raise a `staleTime` below 1 s to 1 s for their observer,
    like TanStack, so the mount right after resolving does not refetch.
  - Errors without data are thrown, and the result type is
    `DefinedQueryResult`: data is always present.
- **Error-reset protocol, the same as TanStack's.** While a boundary is not
  reset, hooks that can throw (Suspense, or `throwOnError`) mount with
  `retryOnMount: false`, so a re-render after an error rethrows instead of
  looping. `reset()` from the boundary's retry lets the next mount refetch.
  Hooks clear the reset after they commit.
- **`usePrefetchQuery`** forks `prefetchQuery` during render when the key is
  not cached. The suspending child then joins the in-flight fetch through
  fetch deduplication.
- **Tests:**
  - 71 core tests and 34 React tests.
  - A test setup file now runs testing-library's `cleanup` (Vitest globals
    are off), which fixed DOM leaking between tests.
  - In headless Chromium, the playground feed shows the Suspense fallback,
    loads 4 pages through "load more", keeps the list visible while loading
    the next page, and logs no console warnings.

### Phase 6: persistence and offline

New in core:

- **`QueryPersister`:** `layer(options)`, `restore`, `persist`, `dehydrate`,
  `hydrate`, `removeClient`, and the `PersistedClient` schema.
- **Opt-in `persist` options:**
  - `persist: { schema }` on queries.
  - `persist: { page, pageParam }` on infinite queries.
  - `persist: { variables }` on mutations.
- **New `QueryClient` members:** `QueryClient.resumePausedMutations` and
  `QueryClient.isRestoring`.
- **`QueryKey.toJsonKey`:** canonical JSON, used as the storage key.

New in React: `useIsRestoring`. Suspense hooks suspend while a background
restore runs.

Decisions made while building it:

- **Persistence is opt-in per query and typed.** A query is stored only if it
  declares a `Schema`. The snapshot holds its data encoded with
  `Schema.toCodecJson`.
  - Restored data is decoded **lazily**: data waits in
    `runtime.preloaded`, keyed by the canonical JSON key, until that key's
    query atom builds its cache entry. This mirrors how
    `Atom.serializable` preloads values.
  - Data that no longer decodes, for example after a schema change, is
    dropped and refetched.
  - Unclaimed data is carried over into the next snapshot, so it is not lost
    when some screens never mount.
  - The snapshot envelope is itself validated with a `Schema`
    (`fromJsonString`).
- **Storage is any `KeyValueStore`**: `layerStorage` for localStorage or
  sessionStorage, `layerMemory`, the file system, SQL, or custom
  (IndexedDB). This also covers React Native with an AsyncStorage-backed
  store (QUESTIONS.md #4).
- **Two restore modes:**
  - `"blocking"` (the default) restores while the layer builds. With
    synchronous storage, the first render already has the data, and
    `QueryClientProvider runtime={…}` works unchanged.
  - `"background"` sets `isRestoring`. Meanwhile, mounts do not fetch,
    Suspense hooks suspend, and `useIsRestoring` is true. When restoring
    finishes, entries claim their data and run the mount fetches that were
    held back, so nothing is fetched that restored fresh data already covers.
- **Writes are throttled** (1 s by default) and driven by cache
  notifications. A final snapshot is written when the layer closes. Writes
  run on the client's runtime, so tests drive them with `TestClock`.
  `buster` and `maxAge` discard whole snapshots, as TanStack does.
- **Offline mutations:**
  - Executions paused while offline are stored when their mutation has
    `persist` and a `key`.
  - On restore they are re-created as paused executions. With
    `resumePausedMutations` (the default) they run once the network allows.
  - Because functions cannot be stored, the definitions are passed as
    `QueryPersister.layer({ mutations: [...] })`, which registers them as
    mutation defaults.
- **Robustness fix:** a _new_ query atom with the _same key_ on every render,
  e.g. one defined inline, used to make `useQuery` re-attach and loop. The
  observer now treats it as the same query and updates the definition in
  place. Module-level atoms remain the recommended style.
- **Tests:**
  - 77 core tests, including mutation-checked persistence tests that fail
    when restoring is disabled.
  - 37 React tests, using happy-dom `localStorage` and a deliberately slow
    store for the background mode.
  - In headless Chromium, the playground todo list survives a reload, and a
    todo added while offline is stored, then saved after the next reload.
    No console warnings.

**v1 scope (phases 1–6) is complete.**

### Phase 7: post-v1 (SSR deferred)

SSR / hydration was explicitly skipped; everything else in phase 7 is done.

- **Tracked properties** (`useQuery`, `useSuspenseQuery`, the infinite hooks):
  - Hook results are wrapped in a `Proxy` that records which properties the
    component reads. The `useSyncExternalStore` snapshot is a counter bumped
    only when a tracked property changed (compared against the view rendered
    last; `Option`s compare by inner reference, `Equal` values such as
    `DateTime` by value). Nothing tracked yet means notify on everything, as
    in TanStack.
  - `notifyOnChangeProps: "all" | ReadonlyArray<string>` overrides it.
  - Suspense / `throwOnError` hooks always track `status`, `isFetching`,
    `error`, `cause`, because throwing depends on them.
  - A property first read after render (in a callback, or a test reading
    `result.current` late) schedules a microtask recheck, so it re-renders if
    the value already moved on.
  - Changes between render and subscription are caught by comparing
    `observer.version` at subscribe time.
  - `useQueries` still re-renders on any change (not tracked yet).
- **Devtools** (`@effect-native-query/devtools`):
  - `QueryDevtools` (floating toggle, docked panel) and `QueryDevtoolsPanel`.
    Query list with TanStack's status colours and observer counts, filter and
    sort, detail view (data, error, meta, timings) with Refetch / Invalidate /
    Reset / Cancel / Remove, and a mutations tab.
  - Inline styles only, no dependencies beyond the workspace packages.
  - Both exports are `() => null` when `process.env.NODE_ENV ===
    "production"`; the size budget verifies the panel is tree-shaken away.
  - Built on a new public core module, `QueryInspector` (plain snapshots,
    `subscribe`, `action`, `run`), instead of reaching into internals.
- **Bundle-size budget:** `scripts/size.ts` bundles consumer entry points
  against the built `dist` (minified, `NODE_ENV=production`, peers external
  unless stated) and checks min+gzip against `size-budget.json`. Run as
  `pnpm size` (part of `ready`); `--update` rewrites budgets at +10%. Current
  sizes: core 14.3 kB, react 16.4 kB (both whole-package), provider +
  `useQuery` 12.3 kB, the same including Effect and React 64.5 kB,
  production devtools 0.15 kB.
- **Examples:** the playground became 12 examples mirroring TanStack's React
  examples (simple, basic, pagination, load-more / infinite scroll, max pages,
  dependent, prefetching, auto-refetching, optimistic UI, optimistic cache,
  suspense, offline). They run against a fake backend `Api` Effect service
  (latency, failure injection, `localStorage`-backed so offline resumes stay
  consistent), with devtools mounted.
- **Docs site:** `apps/docs`, VitePress 2 (alpha; runs on Vite+'s Vite 8).
  Getting started, a TanStack migration table, guides for queries, hooks,
  mutations, infinite queries, Suspense, the client, persistence, devtools
  and testing, and an examples index. The README is still to be written.
- **Fixes found while building the examples:**
  - `Mutation.optimistic` showed an item twice for a moment: the
    `invalidates` refetch landed while the mutation was still pending. A
    mutation execution now records `ranAt` (when `run` succeeded), and the
    overlay stops applying an execution once the query has data fetched
    after that. A regression test checks every intermediate value.
  - `useSuspenseQueries` results are now `SuspenseQueriesResults` (data
    always present).
- **Tests:** 79 core, 44 React, 5 devtools; repeated runs are stable. In
  headless Chromium all 12 examples and the devtools pass a scripted smoke
  test (including the offline item never rendering twice after a reload) with
  no console errors or warnings.
