# effect-atom-query 1.3 — plan

Status: **done, 2026-11-15.** Everything planned for 1.2.1 and 1.3.0 ships in
1.3.0: 1.2.1 was not released separately, because the owner was the only
consumer and wanted the 1.3.0 features at once (released with `skip-cadence`).
Input: [effect-atom-query-migration-report.md](./effect-atom-query-migration-report.md),
a trial migration of a production React app (Redux Toolkit, RTK Query and two
localStorage libraries) to effect-atom-query 1.2.0.

The trial worked: every RTK Query endpoint could be expressed. The cost was in
the integration. The library has one bug that broke every component spec, a
type inference problem, no Promise helper for mutations, no test helpers, and
behaviour that is only documented in the source. This plan fixes what the
library can reasonably own. For everything else it gives the reason it is out
of scope.

## 1. Triage

Every issue in the report, and what this plan does with it.

| Report ref | Issue                                                      | Disposition                                           | Work package |
| ---------- | ---------------------------------------------------------- | ----------------------------------------------------- | ------------ |
| 1.1        | Deferred unbind throws on a disposed registry              | **fix**                                               | WP1          |
| 3          | `useQuery` infers `B` from the return context              | **fix** (fix verified, see WP2)                       | WP2          |
| 3          | Key constants need `as const`                              | docs + small helper                                   | WP3          |
| 3          | `skipToken` doesn't apply to `Query.single`                | docs                                                  | WP8          |
| 2.2        | No Promise-based mutation API, runtime not readable        | **feature**: one Promise boundary helper (D11)        | WP4          |
| 2.5        | No test helpers (idle result, hook results, pending fakes) | **feature**                                           | WP5          |
| 2.4        | Persistence needs Effect Schema; zod apps carry both       | **feature** (Standard Schema for `persist`)           | WP6          |
| 2.4        | `Atom.kvs` behaviour (default, write on read, cross-tab)   | out of scope: `effect/reactivity`, report it upstream | WP6          |
| 2.3        | No `transformErrorResponse`                                | docs (`Effect.mapError` in `run`)                     | WP7          |
| 4          | `"static"` ignores invalidation                            | docs + JSDoc                                          | WP8          |
| 4          | Provider supplies `RegistryContext`                        | docs + JSDoc                                          | WP8          |
| 4          | `mutateEffect` updates hook state                          | docs + JSDoc                                          | WP8          |
| 4          | Structural sharing unverified                              | docs (already tested)                                 | WP8          |
| 5, 6       | Redux migration pitfalls, app-side friction                | docs: "Coming from Redux / RTK Query" (**done**)      | WP8          |
| 2.1        | No HTTP layer                                              | out of scope; documented recipe (**done**)            | §4           |
| Verdict    | Package maturity: same-day releases, one maintainer        | release process                                       | WP9          |

## 2. Releases

Everything below is additive, so no major version is needed.

- **1.2.1 (patch)**: WP1, WP2, the WP8 docs, and WP9, so 1.2.1 is the first
  release published from CI with provenance. These are fixes that users of
  1.2.0 hit today, and they do not need any API decisions.
- **1.3.0 (minor)**: WP3 to WP7.

Leave at least a few days between the two releases (see WP9).

**Outcome:** both shipped together as 1.3.0, the first release published from
CI with provenance. With the owner as the only consumer, the staged rollout
(`next` first, 7 days between stable releases) protected no one yet.

## 3. Work packages

### WP1: Guard the deferred unbind (bug, size S)

**Problem.** `useRegistryBinding` in
`packages/react/src/QueryClientProvider.tsx` unbinds an app-supplied
registry in a `setTimeout(0)` after unmount. When the registry is disposed
before the timer fires, `boundClient(registry)` calls `registry.get(...)`,
which throws `Cannot access Atom QueryClient.current: registry is disposed`
as an uncaught exception. Vitest runs a spec's `afterEach` (which disposes the
registry) before React Testing Library's auto-cleanup (which unmounts), so
every component spec that passes `registry` hits this.

**Fix.** A disposed registry needs no unbind. The `AtomRegistry` interface
does not expose `disposed`, so in the timer callback:

- catch the error from `registry.get` / `registry.set` and return, or
- record disposal ourselves. Not possible without wrapping `dispose`, so
  prefer the `try` / `catch`, kept narrow to the timer body.

Also clear the pending timer in `bindings` when a new owner takes over (this
already happens) and drop the `Binding` entry once the unbind ran, so the
`WeakMap` doesn't hold stale state.

**Tests** (`packages/react/test/regressions.test.tsx`):

- Mount a provider with `registry`, dispose the registry, then unmount and
  flush timers. Expect no uncaught error (`vi.fn` on `process` /
  `window` `error` events, or Vitest's `onUnhandledError`).
- The existing StrictMode and takeover tests keep passing.

**Docs.** Remove the teardown-order warning from the Redux guide once the
fix is released.

### WP2: Infer `B` only from `select` (types, size S)

**Problem.** `useQuery<A, E, R, B = A>` returns `UseQueryResult<B, E>`.
When the call is an argument of another generic function
(`adapt(useQuery(q))`), TypeScript infers `B` from the contextual return type
instead of using the default `A`, and gets `undefined` or `A | undefined`. The
error surfaces far from the cause, usually in JSX props. The app had to hoist
about 10 calls into variables.

**Fix (verified).** Put `NoInfer` on the return type:

```ts
export function useQuery<A, E, R, B = A>(
  query: Query.QueryAtom<A, E, R> | Query.SkippedQueryAtom<A, E>,
  options?: UseQueryOptions<NoInfer<A>, NoInfer<E>, B>,
): UseQueryResult<NoInfer<B>, E>;
```

A probe against the current source confirmed that the nested call then infers
`A`, and that `select: (n) => String(n)` still infers `B = string`.

Apply the same change to every hook that has a `B` parameter:
`useQuery` (both overloads), `useSuspenseQuery`, `useInfiniteQuery` and
`useSuspenseInfiniteQuery`. (`queriesEntry` already infers correctly; its
type test stays as a guard.)

**Tests.** Add type tests (`expectTypeOf`) for each hook: a nested generic
call without `select` infers the data type, and a call with `select` infers
the selected type.

**Changelog.** Call it a fix. Code that relied on inference from the return
context was getting the wrong type, so nothing correct breaks.

### WP3: Query keys without `as const` (types, size S)

**Problem.** `QueryKey` is `readonly [string, ...unknown[]]`. Shared key
constants built with spreads and no `as const` widen to `string[]`, and
`Query.make` / `invalidates` fail with "No overload matches this call", or a
long error that includes the app's branded zod types.

**Plan.**

1. Add `QueryKey.make`, a constructor with a `const` type parameter, so
   tuples are inferred without `as const`:

   ```ts
   export const make = <const K extends QueryKey>(...key: K): K => key;

   const postKeys = {
     all: QueryKey.make("posts"),
     detail: (id: number) => QueryKey.make("posts", "detail", id),
   };
   ```

   This is a typed constructor, not a key factory, so decision D8 ("no key
   factory") still holds. The clarification is recorded in QUESTIONS.md.

2. Docs: a "Key constants" section in `queries.md` showing both `as const`
   and `QueryKey.make`, and the error message that a widened key produces, so
   people can find it by searching for the message.

### WP4: A Promise boundary helper (feature, size S)

**Decision (D11, 2026-11-15).** The library stays purely Effect: the core,
the `QueryClient` API and the hooks take and return Effects, and nothing in
the library uses Promises for its own logic. This keeps D4. What the library
adds is **one small helper for the edge**: code outside the library that
expects a Promise (form libraries, route loaders, third-party callbacks).

The only Promises inside the library are the ones React requires: Suspense
works by throwing a Promise (`suspendOn` in `packages/react/src/internal.ts`,
and `useQueries`). Those are a contract with React, not library logic, and
they stay.

**Status.** Not in the library yet. Today there is only a documented
pattern: export the app's `ManagedRuntime` and call
`runtime.runPromiseExit(save.mutateEffect(x))` (`promises.md`, and the Redux
guide). PLAN.md goal 5 planned a "hook-provided runner" for this, but it was
never built. `useMutation` has `mutate` (callbacks) and `mutateEffect`
(Effect), and no Promise variant.

**Problem.** In the trial, the app wrote its own `useRunPromise()` and
`settleMutation()` (an `Effect.match` to `{ data } | { error }`):

- the provider accepts a runtime but gives no way to read it back;
- the app's hook was typed for one set of services, so `QueryClient`
  Effects did not fit;
- `run(cond ? update.mutateEffect(x) : create.mutateEffect(x))` did not
  type-check. A signature with separate `<A, E>` parameters cannot accept a
  union of two Effects (reproduced on the current toolchain).

**Proposal.** One hook in `@effect-atom-query/react`, `useRunEffect()`. It
returns a runner bound to the provider's client:

```ts
const run = useRunEffect();
const save = useMutation(savePost);

const onSubmit = async (values: Post) => {
  const exit = await run.promiseExit(
    mode === "edit" ? save.mutateEffect(values) : create.mutateEffect(values),
  );
  if (Exit.isSuccess(exit)) navigate(`/posts/${exit.value.id}`);
  else setFormError(exit.cause);
};
```

- **`promiseExit(effect): Promise<Exit<A, E>>`** never rejects. This is the
  recommended form for forms and `.unwrap()`-style flows.
- **`promise(effect): Promise<A>`** rejects with the typed error, for route
  loaders and APIs that expect a rejection.
- The runner is a plain object, stable for the client's lifetime, so it can
  be passed to code outside React.
- An `AbortSignal` option interrupts the Effect, as `ManagedRuntime` does.

**Services.** The client already captures the context of the layer it was
built in (`QueryClient.make` reads `Effect.context()`, which `mutate` uses
today through `ClientRuntime.runFork`). The runner runs Effects in that
context, with `QueryClient` added. So it needs no new core plumbing, and it
works whether the provider got a `runtime` or a `client`. The app declares
its services once, the way TanStack's `Register` declares a default error
type:

```ts
declare module "@effect-atom-query/react" {
  interface Register {
    readonly services: ApiClient | Navigation;
  }
}
```

Without the declaration, only `QueryClient` is available. The declaration is
an assertion: if it lists a service the layer does not provide, the Effect
fails at run time with a missing-service defect, as it would on a
`ManagedRuntime` typed too widely.

**Typing (verified).** Each method infers the whole Effect, not `A` and `E`
separately:

```ts
promiseExit: <X extends Effect.Effect<any, any, QueryClient | Services>>(
  effect: X,
  options?: { readonly signal?: AbortSignal },
) => Promise<Exit.Exit<Effect.Success<X>, Effect.Error<X>>>;
```

A probe confirmed that a union of Effects infers the union of success and
error types, a single Effect keeps its exact types, and an Effect that needs
an undeclared service is rejected at compile time.

**Not included, on purpose.**

- `mutateExit` / `mutateAsync` on `useMutation`. The runner plus
  `mutateEffect` covers it, and keeps Promises out of the hook API (D4).
- A Promise API on `QueryClient`. The core stays Promise-free.
- An outcome type like `{ data } | { error }`. `Exit` already is one.

**Tests.** `promiseExit` resolves with success, typed failure, defect and
interruption (an aborted `signal`), and never rejects. `promise` rejects
with the typed error. Running `mutateEffect` through the runner updates the
hook's `isPending` / `error`. The runner uses the client's services with
both provider forms. Type tests for the union case, the `Register`
declaration and a rejected undeclared service.

**Docs.** Rewrite `promises.md` around `useRunEffect` (keeping the
`ManagedRuntime` route for code with no React tree), and update the "No
Promises" section of `from-tanstack.md` and the mutations part of
`from-redux.md`. D11 is recorded in QUESTIONS.md.

### WP5: Test utilities (feature, size M)

**Problem.** The app built its own `makeTestAppState`, runtime wiring, a fake
mutation hook and result adapters. The specific gaps:

- No idle (disabled) query result. `QueryResult.disabled` needs an
  `AsyncResult` argument.
- `QueryResult.success(...)` builds a `QueryResult`, not a
  `UseQueryResult`, so standing in for the hook needs a cast (no `refetch`).
- Fake responses resolve at once, so loading states cannot be tested without
  mocking `useQuery`.

**Plan.**

1. Core (`@effect-atom-query/query`):
   - `QueryResult.idle()`: `status: "pending"`, `fetchStatus: "idle"`,
     `isLoading: false`, which is what a disabled query returns.
   - Make the `QueryResult.disabled` argument optional, with the same
     meaning.
2. A new subpath, `@effect-atom-query/react/testing`, so the main entry and
   its size budget do not change. It has no test-runner dependency:
   - `UseQueryResult` / `UseMutationResult` constructors that take a core
     result plus optional overrides and fill in the hook fields (`refetch`,
     `mutate`, `mutateEffect`, `reset`) with no-ops:

     ```ts
     useTodosQuery.mockReturnValue(queryHookResult(QueryResult.success(todos)));
     useSave.mockReturnValue(mutationHookResult(MutationResult.idle(), { mutate: vi.fn() }));
     ```

   - `testQueryClientLayer(options?)` (and `testDefaultOptions`): no retries, no focus or reconnect
     refetches, `gcTime: "Infinity"`, so tests do not time out or refetch
     unexpectedly. This is the configuration `testing.md` already
     recommends.
   - `controlled<A, E>()`: `{ effect, succeed(a), fail(e) }` on a
     `Deferred`, so a fake service can stay pending until the test completes
     it. Loading-state tests no longer need hook mocks.
   - `makeTestHarness(layer)`: `{ runtime, registry, Wrapper, dispose }`,
     where `Wrapper` is the provider for `render` / `renderHook` and
     `dispose` disposes the runtime and the registry. With WP1 fixed, the
     order of teardown no longer matters.
3. Docs: rework `testing.md` around the helpers, with a "Mock a named hook,
   not `useQuery`" section. The trial had to mock the generic `useQuery` with
   a dispatcher keyed on atom identity, which needed a dynamic `import()`
   inside `vi.mock`. Per-endpoint wrapper hooks avoid that.

**Size.** Add a `react: testing` entry to `size-budget.json`, and confirm the
main entries are unchanged.

### WP6: Persistence with Standard Schema (feature, size M)

**Problem.** `persist: { schema }` requires an Effect Schema codec. Apps
that validate with zod now carry two schema libraries.

**Plan.** Accept any [Standard Schema v1](https://standardschema.dev)
validator (zod, Valibot, ArkType) in `persist.schema` for **JSON-compatible**
data:

- decode: `schema["~standard"].validate(json)`, with issues mapped to the
  same decode failure the Effect codec path produces (the entry is dropped
  and the query refetches);
- encode: identity, as the data is already JSON.

Effect Schema values keep the codec path, so `DateTime`, `Option` and branded
types still round-trip. Check for an Effect Schema first, in case Effect
schemas also expose `~standard`. Restoring is synchronous (entries are
decoded in `claimPersisted` when a query is first used), so only synchronous
validators are supported; an async result drops the entry and warns once.

`Persist<A>` becomes a union. Type tests check that the validator's output
type has to match the query's `A`.

**Not in scope: `Atom.kvs`.** Persisting client state is `effect/reactivity`'s
`Atom.kvs`, not this library. Its behaviour (the default is bound when the
atom is defined, a missing key is written on first read, no cross-tab sync,
an external removal is not noticed) is documented in the Redux guide. Open
upstream issues for cross-tab sync and external-removal detection. Shipping a
competing client-state persistence API here would blur the library's scope
(server state).

### WP7: Error transforms (docs, size S)

RTK's `transformErrorResponse` has no counterpart because `run` is an
Effect: `Effect.mapError` in `run` already changes the error, and the error
type flows to `useQuery` and `throwOnError`. A separate option would be a
second way to do the same thing. Document the pattern in `queries.md`, with a
shared-transform example (`run: (id) => api.get(id).pipe(Effect.mapError(toUiError))`).

### WP8: Documentation (docs, size M)

| Topic                                                                                                    | Where                                                      |
| -------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------- |
| `"static"` is skipped by invalidation and refetch; use `"Infinity"` for "cached until invalidated"       | `queries.md` options table + callout; `staleTime` JSDoc    |
| `QueryClientProvider` supplies `RegistryContext`: do not add a `RegistryProvider`                        | `react.md`; provider JSDoc                                 |
| `mutateEffect` updates the hook's state like `mutate`                                                    | `mutations.md`; `UseMutationResult.mutateEffect` JSDoc     |
| What structural sharing keeps: plain objects and arrays only, class instances and `Data` values replaced | `queries.md` (behaviour tested in `QueryObserver.test.ts`) |
| `skipToken` for families, `enabled: false` for `Query.single`                                            | `queries.md` "Disabling queries"                           |
| Key constants: `as const` / `QueryKey.make`                                                              | `queries.md` (WP3)                                         |
| `Data.TaggedError` has `message: ""`: set a real message on API errors                                   | `from-redux.md` (done), `queries.md` errors note           |
| `Service.use` trips `react-hooks/rules-of-hooks`                                                         | `from-redux.md` (done), `getting-started.md`               |
| **Coming from Redux / RTK Query**                                                                        | `guide/from-redux.md` (**done** with this plan), README    |

### WP9: Release process (process, size S)

The report's adoption concern was the package's age more than any code
issue. 0.0.0, 1.0.0 and 1.2.0 were published on one day by one maintainer,
and a consumer's `minimum-release-age` setting would have blocked the
install. The plan:

- **Cadence.** At most one stable release per week, except for security
  fixes. Ship changes to the `next` dist-tag first (`changeset pre enter
  next`), and promote to `latest` after a soak period.
- **Provenance.** Publish from GitHub Actions with npm trusted publishing
  and `--provenance`, instead of from a laptop (amends D6). Consumers can
  then verify where each tarball was built.
- **Review.** Require a second reviewer (human, or a bot plus a human) on
  changes to `packages/*/src`.
- **Support policy.** Write down in `RELEASING.md` which versions get fixes
  and how deprecations are announced.

**Outcome (2026-11-15).** Done, as decision D12. The Release workflow,
release guard, CODEOWNERS and the rewritten `RELEASING.md` shipped in #13; the
npm and GitHub settings (trusted publishing, token publishing disallowed, the
`npm` environment, branch protection on `main`) were configured before the
1.3.0 release. 1.3.0 was the first release published this way, with
provenance, after three attempts: each package's trusted publisher entry
needed fixing first (see "Troubleshooting a release" in `RELEASING.md`). The
review requirement is relaxed while there is one maintainer: pull requests
are required, approvals are not.

### Found during implementation

- **Closing the client refetched every mounted query atom once (pre-existing,
  fixed in 1.3.0).** Found while testing WP6. When the client's scope closes, its
  cache removes every entry. A query atom read through a registry
  (`registry.mount`, `useAtomValue`, code outside React) reacted to the
  removal by rebuilding itself, which created a new entry in the closed cache
  and fetched it, against a runtime that was shutting down. `QueryObserver`
  (the `use*Query` hooks) already checked `cache.isDisposed`; the atom path
  did not, and the existing regression test only covered the observer. The
  atom now keeps its last result instead of rebuilding, and an atom first read
  after shutdown returns a disabled result without creating an entry.
  Regression test in `regressions.test.ts`.

## 4. Out of scope, and why

- **An HTTP layer (2.1).** `run` is any Effect, which is why "http" was
  rejected from the name (D5). An HTTP layer would tie the library to one
  transport and one error shape. Instead, the Redux guide shows a
  `fetchBaseQuery`-style service on `HttpClient` from `effect/http` (base URL,
  bearer token, status, fetch and parse errors). Revisit as a separate
  optional package if several adopters ask for it.
- **Generated per-endpoint hooks.** Definitions are atoms (D1). The docs
  recommend thin named wrappers instead, which also solves the mocking
  problem (WP5).
- **App-side adapters** (RTK-shaped results, `unvalidated<T>` casts, auth
  config pulled into component tests, base URL timing, storage key prefixes,
  migration order). These belong to the app. The Redux guide covers each one.
- **Translated fallback error messages.** That is an app concern.

## 5. Definition of done

For every work package:

- `vp check` and `vp run -r test` pass, and coverage stays at 90% or more
  in every package.
- `vp run size` stays within `size-budget.json` (new entries for new
  subpaths).
- A changeset describes the user-facing change.
- The docs site pages listed in the work package are updated, and
  `FEATURE-MATRIX.md` reflects new APIs.
- WP1, WP2 and WP4 each have a regression or type test that fails on 1.2.0.

Before releasing 1.3.0, re-run the trial migration branch on
it. Delete `useRunPromise`, `settleMutation`, the result-hook casts and the
teardown workaround, and confirm the suite stays green.
