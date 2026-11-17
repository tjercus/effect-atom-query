# Effect guidelines review, 2026-11-17

Scope: all source in `packages/query`, `packages/react`, `packages/devtools`,
`apps/flight-dashboard`, `apps/playground` and `scripts`, plus the test folders,
checked against the "Coding guidelines" in `AGENTS.md`: follow Effect's own
guidance (`docs/repos/effect/LLMS.md`, `ai-docs`, `.agents/skills`) and do not
throw unless a contract requires it.

How to read the tags:

- **[probe]**: reproduced with a test.
- **[read]**: found by reading the code, not reproduced.

Gaps: in `packages/query`, `internal/queryEntry.ts` lines 440–800 and 1000+,
and `QueryClient.ts` lines 560–700, were only searched for the checklist
patterns, not read in full.

Status column: **fixed** means fixed in the change that added this document.

## 1. Fix first

| #   | Severity | Status | Tag     | Finding                                                                                                                                                                                                                                                                                                                   |
| --- | -------- | ------ | ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | High     | fixed  | [probe] | `QueryPersister.ts:106,304`: the snapshot is written with `Schema.encodeSync`. Standard Schema data is stored unchecked, so non-JSON data makes it throw. The throw is a defect, which `Effect.ignore` (`:358`) does not absorb: the throttled write or the layer finalizer dies, and one bad query stops all persisting. |
| 2   | Medium   | fixed  | [read]  | `react/src/QueryClientProvider.tsx:190`: empty `catch {}` meant for a disposed registry also swallows errors thrown by subscribers during `registry.set`.                                                                                                                                                                 |
| 3   | Medium   | fixed  | [read]  | `devtools/src/QueryDevtools.tsx:554`: `useOptionalQueryClient` uses `try`/`catch` as control flow around `useQueryClient()` and turns every error into `undefined`.                                                                                                                                                       |
| 4   | Medium   | fixed  | [read]  | `query/src/QueryInspector.ts:84`: `safeHash` has an empty `catch`; the non-throwing `jsonKey` helper already exists.                                                                                                                                                                                                      |
| 5   | High     | fixed  | [read]  | `apps/playground/src/api.ts:90,100`: `localStorage` read and write errors are swallowed, and `JSON.parse(...) as Array<Todo>` is a cast instead of `Schema` validation.                                                                                                                                                   |
| 6   | Medium   | fixed  | [read]  | `apps/playground/src/api.ts:204`: `throw new Error("no character …")` inside `Effect.sync` turns an expected failure into an untyped defect; it should be `Effect.fail(new ApiError(...))`.                                                                                                                               |

## 2. Medium

| #   | Finding                                                                                                                                                                                                                                                                                                  |
| --- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 7   | **Fixed.** `apps/flight-dashboard/src/api/layers.ts:221,233`: `Date.now()`, which `LLMS.md` forbids; ignores `TestClock`. Use `Clock.currentTimeMillis`.                                                                                                                                                 |
| 8   | **Fixed.** `packages/devtools/src/QueryDevtools.tsx:143`: `Date.now()` for "ago" labels, while snapshot times come from `client.runtime.now()`; use the latter.                                                                                                                                          |
| 9   | **No change:** `Effect.fn` defeats `Mutation.make`'s inference of the context type `C` (the plain arrow is what lets TypeScript infer it). `apps/playground/src/examples/OptimisticCache.tsx:17`: a demo callback that only wraps and returns `Effect.gen`; should be `Effect.fn`. Users copy the demos. |

## 3. Low

### Throwing and catching

| #   | Finding                                                                                                                                                                                                                                                                                    |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 10  | **Fixed.** `Option.getOrThrow` right after a check that already rules out `None`; narrow instead: `MutationResult.ts:152`, `MutationObserver.ts:137`, `QueryPersister.ts:226`, `react/src/internal.ts:75,119,149`.                                                                         |
| 11  | **Fixed** (new `internal/jsonKey.ts` with `jsonKey` and `keyLabel`). Key formatting with `toJsonKey` that can throw while building a label or error message: `Mutation.ts:159`, `QueryClient.ts:287` (also built eagerly), `internal/mutationEntry.ts:255`. Use `jsonKey` with a fallback. |
| 12  | **Fixed** (logs a warning). `QueryPersister.ts:266`: `Effect.catch(() => …)` swallows every `KeyValueStoreError` without logging it.                                                                                                                                                       |
| 13  | **Fixed** (`Result.try`; the plain-string fallback is kept, since it is only a label). `devtools/src/format.ts:77`: `catch {}` falls back to `String(key)` and drops the reason.                                                                                                           |
| 14  | **Fixed** (a named, documented error; the message is unchanged). `devtools/src/QueryDevtools.tsx:311`: throws an untyped `new Error` where `MissingQueryClientProviderError` already exists.                                                                                               |
| 15  | **No change:** the option is typed `Duration.Input`, so bad input is a programmer error, as accepted for the query package in section 4. `apps/flight-dashboard/src/api/layers.ts:102`: `Duration.fromInputUnsafe` inside `Layer.sync`; use `Duration.fromInput` with a default.           |

### Effect style

| #   | Finding                                                                                                                                                                                                                                                                                                            |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 16  | **Fixed** (top-level ones marked `/* @__PURE__ */` so they still tree-shake). Functions that only wrap and return `Effect.gen`; use `Effect.fnUntraced`: `QueryPersister.ts` (`readSnapshot`, `restore`, `persist`), `Mutation.ts:310-342`, `InfiniteQuery.ts:281`, `test/utils.ts:21`, `test/triggers.test.ts:7`. |
| 17  | **Fixed** (`Effect.forkDetach`: `resumePausedMutations` needs no context, the mutations run in the client's). `QueryPersister.ts:342`: `Effect.sync(() => client.runtime.runFork(...))` leaves the runtime from inside an Effect; `Effect.forkDetach` would work, or document why the client's context is needed.  |
| 18  | **Fixed** (internal `ClientRuntime.runPromiseExit`; the already-aborted check stays, since Effect's runner would run the synchronous part first). `react/src/useRunEffect.ts:79`: hand-built `new Promise` around `runFork`; an internal `runPromiseExit` on `ClientRuntime` would replace it.                     |

### `LLMS.md` rules

| #   | Finding                                                                                                                                                                                                                                             |
| --- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 19  | **Fixed.** `internal/persistCodec.ts:106`: own `isPromiseLike` instead of `Predicate.isPromiseLike` ("NEVER write your own helper functions").                                                                                                      |
| 20  | **Fixed** (`Schema.is` on the stored shape; the equal-length check stays a plain comparison). `internal/persistCodec.ts:173`: checks the infinite-query JSON shape by hand instead of with a `Schema` ("AVOID using predicates or manual parsing"). |
| 21  | **Fixed.** `apps/playground/src/api.ts:11-44`: domain types are plain interfaces instead of `Schema`s.                                                                                                                                              |
| 22  | **Fixed** (`Schema.FiniteFromString`, at least 0, default 1 second; reproduced with a test). `apps/flight-dashboard/src/api/layers.ts:40`: `Number(retry-after header)` gives `NaN` on bad input; decode with `Schema.NumberFromString`.            |
| 23  | **Fixed** (`DateTime.now` and `DateTime.formatLocal`). `apps/playground/src/api.ts:152`: `new Date().toLocaleTimeString()`; use `DateTime`.                                                                                                         |

### API types

| #   | Finding                                                                                                         |
| --- | --------------------------------------------------------------------------------------------------------------- |
| 24  | **Fixed** (an `undefined` override keeps the default). `react/src/testing.tsx:38,56`: optional fields without ` | undefined`. The fix is type-only but needs a runtime default, or the overrides spread copies `undefined`. |

### Tests

| #   | Finding                                                                                                                                                               |
| --- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 25  | All `packages/query/test` files use `expect`; Effect's test conventions (`test-development/runtime.md`) say to use `assert` from `@effect/vitest`. Migrate gradually. |
| 26  | `react/test/testing.test.tsx:83-148`: pure-Effect tests run effects by hand in async `it`; use `it.effect`.                                                           |
| 27  | `Effect.runSync(getQueryData)` in final assertions: `react/test/useRunEffect.test.tsx:118`, `react/test/testing.test.tsx:184`.                                        |

## 4. Checked and OK

- React: throwing a Promise for Suspense and throwing to error boundaries
  (`throwOnError`, defects) match Effect's own atom-react
  (`packages/atom/react/src/Hooks.ts`). Hooks throwing outside their provider
  is the React convention.
- `QueryClient.fromAtomContext` throw: an atom read function signals failure
  to the registry by throwing; documented in JSDoc.
- `internal/persistCodec.ts` `guard` and `jsonKey`: the single narrow boundary
  that turns exceptions from user schemas and `JSON.stringify` into values.
- `Effect.die` for programmer errors (no `run`).
- `runFork` from synchronous atom and observer callbacks, and `runSync` in the
  provider: there is no fiber to compose with.
- `Duration.fromInputUnsafe` in the query package: the input is typed
  `Duration.Input`, so bad input is a programmer error.
- `scripts/*.ts` do not use Effect; a top-level throw that ends the script is
  fine.
- All optional fields of exported option types in `packages/query` are
  `readonly` with `| undefined`.
