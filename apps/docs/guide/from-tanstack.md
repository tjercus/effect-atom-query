# Coming from TanStack Query

The caching model is TanStack Query's: the same defaults, the same lifecycle
(fresh, stale, inactive, garbage collected), and the same triggers, filters
and hooks. What changes is the language around it.

| TanStack Query                                          | effect-atom-query                                                   |
| ------------------------------------------------------- | ------------------------------------------------------------------- |
| `queryFn: () => Promise<T>`                             | `run: Effect<A, E, R>`: typed errors, services from the runtime     |
| `queryKey` + `queryFn` passed to every hook             | queries defined once (`Query.make`); hooks receive the atom         |
| `queryOptions({ ... })`                                 | `Query.single` / `Query.make` (`Query.queryOptions` alias)          |
| `data: T \| undefined`, `error: E \| null`              | `data: Option<A>`, `error: Option<E>`, plus `cause` for defects     |
| `data ?? []`                                            | `Option.getOrElse(result.data, () => [])`                           |
| `declare module ... Register { defaultError }`          | not needed: every query has its own error type                      |
| `retry: 3`, `retryDelay`                                | `retry: 3`, or any `Schedule`                                       |
| `AbortSignal`                                           | fiber interruption, so nested Effects are cancelled too             |
| `enabled: !!id`                                         | `todoQuery(id ?? Query.skipToken)`, or `enabled: (arg) => ...`      |
| `queryClient.fetchQuery()` → `Promise`                  | `client.fetchQuery(query)` → `Effect`                               |
| `new QueryClient()` + `QueryClientProvider client`      | `QueryClient.layer()` in a runtime + `QueryClientProvider runtime`  |
| `new QueryClient({ defaultOptions })`                   | `QueryClient.layer({ defaultOptions })`                             |
| `mutateAsync(input).then().catch()`                     | `mutate(input, { onSuccess, onError })`, or `yield* mutateEffect`   |
| `onMutate` / `onError` / `onSettled` returning promises | the same callbacks returning Effects, with `QueryClient` in context |
| `onSuccess: () => invalidateQueries(...)`               | `invalidates: [["todos"]]`                                          |
| `useMutationState({ select })`                          | the same; also `Mutation.optimistic(query, mutation, apply)`        |
| `persistQueryClient` + `dehydrate` options              | `QueryPersister.layer` + per-query `persist: { schema }`            |
| `focusManager`, `onlineManager`                         | `FocusManager` / `OnlineManager` services                           |
| `@tanstack/react-query-devtools`                        | `@effect-atom-query/devtools`                                       |

## Differences you will notice while porting

### `invalidates` waits for the refetch

In TanStack Query, the mutation waits for the refetch only if the callback
returns the promise: `onSettled: () => queryClient.invalidateQueries(...)` waits,
while `onSettled: () => { queryClient.invalidateQueries(...) }` settles straight
away. `invalidates` always waits, and runs only when the mutation **succeeds**,
not on error.

The mutation stays **pending** until the refetches of the active queries that
match have finished. A refetch that fails keeps the query's previous data and
error; the mutation still succeeds. If you port callbacks that did not return
the promise, you will see this in the UI: a form that navigates in
`onSuccess` now navigates after the refetch, and its submit button stays
disabled while `isPending` is `true` a little longer. See
[Invalidation](./mutations#invalidation).

### Queries are defined once

`useQuery({ queryKey, queryFn })` at each call site becomes a definition at
module level, and hooks receive it:

```ts
// todoApi.ts
export const todosQuery = Query.single({ key: ["todos"], run: TodoRepo.use((r) => r.list) });
export const todoQuery = Query.make({
  key: (id: string) => ["todos", id],
  run: (id) => TodoRepo.use((r) => r.get(id)),
});

// in a component
const todos = useQuery(todosQuery);
const todo = useQuery(todoQuery(id));
```

### No Promises

There is no `mutateAsync`. Use the callbacks of `mutate` for UI work, or
`mutateEffect` inside an Effect:

```ts
const save = useMutation(saveTodo);
save.mutate(todo, {
  onSuccess: () => navigate("/todos"),
  onError: (cause) => console.error(Cause.pretty(cause)),
});
```

The client's imperative methods (`fetchQuery`, `ensureQueryData`, …) return
Effects as well. Where an API needs a Promise (route loaders, form
libraries), see [Promise boundaries](./promises).

### Results use `Option`

`data` and `error` are `Option`s, so check them instead of comparing with
`undefined`:

```ts
const titles = Option.getOrElse(result.data, () => []);
if (Option.isSome(result.error)) showError(result.error.value);
```

`error` holds only the query's typed failures. Defects (bugs, `Effect.die`)
are thrown to the nearest error boundary.

### Services come from the runtime

Instead of creating a `QueryClient` and closing over API clients in `queryFn`,
build one runtime with the client and your services. Queries get their
services from it:

```tsx
const runtime = ManagedRuntime.make(QueryClient.layer().pipe(Layer.provideMerge(AppLayer)));

<QueryClientProvider runtime={runtime}>
  <App />
</QueryClientProvider>;
```

## Not (yet) supported

- SSR: `dehydrate`/`hydrate` and `HydrationBoundary` are planned after v1.
- A default `queryFn` keyed by `queryKey`. Every query declares its own `run`,
  which is what makes the types flow.
- `streamedQuery` and `experimental_prefetchInRender`.
- Promise-returning client methods. The imperative API is Effect-only by
  design; see [Promise boundaries](./promises) for loaders and forms.

## Atoms all the way

Every query and mutation is an Effect Atom. Anything in `effect/reactivity`
composes with them (`Atom.map`, `Atom.family`, `useAtomValue`, `AtomRegistry`
outside React), and `QueryResult.result` is the underlying `AsyncResult`.
