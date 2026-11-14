# Mutations

## Defining mutations

```ts
const addTodo = Mutation.make({
  key: ["todos", "add"], // optional; used by filters and persistence
  run: (title: string) => TodoRepo.use((repo) => repo.add(title)),
  invalidates: [["todos"]], // refetch these after success
});
```

A mutation is a writable atom holding its latest execution. Run it in any of
three ways:

```ts
registry.set(addTodo, "buy milk"); // atom style
client.mutate(addTodo, "buy milk"); // Effect<Todo, TodoError, TodoRepo>

const add = useMutation(addTodo, { onSuccess: () => setTitle("") });
add.mutate("buy milk"); // fire and forget
add.mutateEffect("buy milk"); // an Effect: yield* it to await the result
```

`useMutation` keeps per-component state (`status`, `isPending`, `variables`,
`data`, `error` as Options, `isPaused`, `failureCount`, `reset()`). The UI
callbacks (`onSuccess`, `onError`, `onSettled`) fire only for this
component's latest execution while it is mounted. Definition callbacks always
run.

## Invalidation

`invalidates` takes query keys, matched by prefix, or a function of
`(data, input)`. The mutation stays **pending until the active matching queries
have refetched**, so a UI that waits for the mutation never flashes stale data.

`reactivityKeys` does the same through Effect's `Reactivity` service, which
also drives `AtomHttpApi` and `AtomRpc` queries.

## Optimistic updates via the UI

`Mutation.optimistic` overlays pending variables on a query. Nothing is written
to the cache, so there is nothing to roll back:

```ts
const optimisticTodos = Mutation.optimistic(todosQuery, addTodo, (todos, title) => [
  ...todos,
  { id: "pending", title },
]);

const todos = useAtomValue(optimisticTodos); // QueryResult with pending titles appended
```

A failed execution simply disappears from the overlay. A successful one hands
over to the refetched list without showing the item twice.

## Optimistic updates via the cache

Definition callbacks are Effects with the `QueryClient` in context, so the
snapshot and rollback pattern is plain Effect code:

```ts
const addTodo = Mutation.make({
  run: (title: string) => api.add(title),
  onMutate: (title) =>
    Effect.gen(function* () {
      const client = yield* QueryClient.QueryClient;
      yield* client.cancelQueries({ queryKey: ["todos"] });
      const previous = yield* client.getQueryData(todosQuery);
      yield* client.setQueryData(todosQuery, (todos) =>
        Option.map(todos, (list) => [...list, { id: "pending", title }]),
      );
      return previous; // becomes `context`
    }),
  onError: (_cause, _title, previous) =>
    QueryClient.QueryClient.pipe(
      Effect.flatMap((client) => client.setQueryData(todosQuery, () => Option.flatten(previous))),
    ),
  onSettled: () =>
    QueryClient.QueryClient.pipe(
      Effect.flatMap((client) => client.invalidateQueries({ queryKey: ["todos"] })),
    ),
});
```

## More options

| option        | meaning                                                                      |
| ------------- | ---------------------------------------------------------------------------- |
| `retry`       | default none; a number, boolean or `Schedule`                                |
| `networkMode` | `"online"` (default) pauses while offline                                    |
| `scope`       | a string (or function of the input): same-scope executions run one at a time |
| `gcTime`      | how long a settled, unobserved execution stays cached (5 minutes)            |
| `persist`     | `{ variables: Schema }`: persist executions paused while offline             |

Defaults for every mutation go in `defaultOptions.mutations`, and per key in
`client.setMutationDefaults(key, options)`.

## Mutation state elsewhere

```tsx
const saving = useIsMutating({ mutationKey: ["todos"] });
const pendingTitles = useMutationState({
  filters: { mutationKey: ["todos", "add"], status: "pending" },
  select: (m) => m.variables,
});
```
