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
const program = Effect.gen(function* () {
  const todo = yield* client.mutate(addTodo, "buy milk"); // in an Effect, with TodoRepo
});

const add = useMutation(addTodo, { onSuccess: () => setTitle("") });
add.mutate("buy milk"); // fire and forget
add.mutateEffect("buy milk"); // an Effect: yield* it to await the result
```

`useMutation` keeps per-component state (`status`, `isPending`, `variables`,
`data`, `error` as Options, `isPaused`, `failureCount`, `reset()`). The UI
callbacks (`onSuccess`, `onError`, `onSettled`) fire only for this
component's latest execution while it is mounted. Definition callbacks always
run.

`onError` receives the `Cause`, the input and the typed failure as an `Option`
(`None` for defects), so UI code does not have to dig it out of the cause:

```ts
add.mutate(title, {
  onError: (_cause, _title, error) => {
    if (Option.isSome(error)) showToast(error.value.message);
  },
});
```

## Invalidation

`invalidates` takes query keys, matched by prefix, or a function of
`(data, input)`. The mutation stays **pending until the active matching queries
have refetched**, so a UI that waits for the mutation does not flash the data
from before it. A refetch that fails keeps the previous data and sets the
query's error; the mutation still succeeds.

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

`Mutation.optimisticUpdate(query, update)` returns `onMutate`, `onError` and
`onSettled` callbacks to spread into a definition. Before `run`, it cancels the
query's running fetches, snapshots its data and writes `update(data, input)`.
If the mutation fails, it restores the snapshot. Once the mutation settles,
after success or failure, it invalidates the query and waits for it to
refetch, so the cache matches the server even when several mutations overlap
and one rolls back another's update:

```ts
const deleteTodo = Mutation.make({
  run: (id: string) => TodoRepo.use((repo) => repo.delete(id)),
  ...Mutation.optimisticUpdate(todosQuery, (todos, id) => todos.filter((t) => t.id !== id)),
});
```

The query is refetched already, so it needs no `invalidates` entry (one would
refetch it a second time). Only an active query refetches; an inactive one is
marked stale, keeps the restored snapshot, and refetches when it is next used.

To update one member of a family, pass a function of the input:
`Mutation.optimisticUpdate((todo: Todo) => todoQuery(todo.id), (_old, todo) => todo)`.
While the query has no data, nothing is written and a first load keeps
running.

To add your own callbacks as well, spread the helper and call its callback
from yours:

```ts
const cache = Mutation.optimisticUpdate(todosQuery, (todos, id: string) =>
  todos.filter((t) => t.id !== id),
);
const deleteTodo = Mutation.make({
  run: (id: string) => TodoRepo.use((repo) => repo.delete(id)),
  ...cache,
  onError: (cause, id, context) =>
    Effect.andThen(cache.onError(cause, id, context), Effect.logWarning("delete failed")),
});
```

Or write the pattern out. Definition callbacks are Effects with the
`QueryClient` in context, so it is plain Effect code:

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
  // refetch after success *and* failure, so a rollback cannot leave stale data
  onSettled: () =>
    QueryClient.QueryClient.pipe(
      Effect.flatMap((client) => client.invalidateQueries({ queryKey: ["todos"] })),
    ),
});
```

### Which one to pick

- **Via the UI** (`Mutation.optimistic`): only the views that read the
  overlay atom show the change, and nothing in the cache needs rolling back.
  Concurrent mutations stack correctly. Pick this by default.
- **Via the cache** (`Mutation.optimisticUpdate`): every reader of the query
  sees the change, including other components using `useQuery`, and code
  outside React. Pick this when the change must show everywhere at once.

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
