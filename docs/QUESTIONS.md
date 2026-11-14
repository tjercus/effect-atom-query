# Decisions and open questions

## Decided (2026-11-13)

| ID  | Question                                  | Decision                                                                                                                                                                                                                                                                                                                                           |
| --- | ----------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| D1  | How are queries defined?                  | **Atom-first with a thin compat layer.** Use `Query.make({ key, run })` at module level and call `useQuery(todoQuery(id))`. `queryOptions`, `infiniteQueryOptions` and `mutationOptions` are thin aliases to ease porting. Inline `useQuery({ queryKey, queryFn })` is not supported.                                                              |
| D2  | What does `useQuery` return?              | **TanStack-style fields and flags plus `result: AsyncResult`, but never `undefined`.** `data`, `error`, `failureReason`, timestamps and getters (`getQueryData`) are `Option`s. The result is a discriminated union on `status`, so `isSuccess` narrows `data` to `Option.Some<A>`. Suspense and `initialData` variants expose `data: A` directly. |
| D3  | What is in v1 besides the core?           | **Suspense and error boundaries, infinite queries, and persistence with offline support.** SSR and hydration come after v1.                                                                                                                                                                                                                        |
| D4  | Does `QueryClient` get an imperative API? | **Effect only.** There is no Promise or sync facade and no `mutateAsync`. `useMutation` exposes `mutate` (fire and forget) and `mutateEffect`.                                                                                                                                                                                                     |

## Still open (I'll use the default unless you say otherwise)

1. **Package names.** The default is `@effect-native-query/query` and
   `@effect-native-query/react`. Do you plan to publish, and if so under what
   npm scope?
2. **Defect handling.** The default is that defects (`Cause.Die`) always throw
   to the nearest React error boundary, while typed `E` failures only throw
   when `throwOnError` is set. Should interrupts (from `cancel`) ever be
   visible to users? The default is no: the query reverts to its previous
   state.
3. **Key representation.** The default is tuples normalised to `Data`
   structures, compared with `Equal`/`Hash`, plus a typed `QueryKey.factory`.
   Alternatively, keys could be required to be `Schema`-encodable, which would
   make persistence keys trivially serialisable but adds ceremony. The current
   lean is to require a Schema only for persisted queries.
4. **Persistence storage targets for v1.** _(Resolved in phase 6: any `KeyValueStore`, which covers localStorage, IndexedDB, memory, file system, SQL, and AsyncStorage via a custom store.)_ The default is localStorage and
   IndexedDB through `KeyValueStore` layers. Is React Native (AsyncStorage)
   needed?
5. **Devtools.** _Addressed in phase 7:_ `@effect-native-query/devtools` ships
   an in-app panel (query/mutation inspector with actions), built on the
   public `QueryInspector` API. Still open: should it also integrate with a
   browser-extension devtools (e.g. TanStack's devtools protocol), and should
   it be published as its own package or folded into `/react`?
6. **Language service plugin.** `@effect/language-service` is installed and
   configured. It patches the TS 5 language service and may not work fully
   with TS 7's native server yet. That is acceptable for now. Do you want to
   track this?
