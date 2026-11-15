# Testing

Queries are Effects and the client is a service, so tests use ordinary Effect
tools.

## Core logic with TestClock

```ts
import { it } from "@effect/vitest";

it.effect("goes stale after staleTime", () =>
  Effect.gen(function* () {
    const client = yield* QueryClient.make();
    const q = Query.single({ key: ["n"], run: Effect.succeed(1), staleTime: "1 minute" });
    yield* client.fetchQuery(q);
    yield* TestClock.adjust("2 minutes");
    const state = yield* client.getQueryState(q);
    expect(Option.getOrThrow(state).isStale).toBe(true);
  }).pipe(Effect.scoped),
);
```

Swap services the usual way. Provide a fake repository layer, and drive focus
and connectivity with test managers:

```ts
const online = OnlineManager.make({ setup: () => () => {} });
QueryClient.make().pipe(Effect.provideService(OnlineManager.OnlineManager, online));
online.setOnline(false);
```

## Components and hooks

`@effect-atom-query/react/testing` has the pieces a component test needs. It
does not depend on a test runner.

```ts
import {
  controlled,
  makeTestHarness,
  mutationHookResult,
  queryHookResult,
  type TestHarness,
} from "@effect-atom-query/react/testing";
```

### A harness per test

`makeTestHarness` builds a client with [test defaults](#test-defaults), your
fake services, a registry, and a provider component:

```tsx
const FakeTodoRepo = Layer.succeed(
  TodoRepo,
  TodoRepo.of({ list: Effect.succeed([{ id: "1", title: "learn Effect" }]) }),
);

let harness: TestHarness<TodoRepo, never>;
beforeEach(() => {
  harness = makeTestHarness({ layer: FakeTodoRepo });
});
afterEach(() => harness.dispose());

it("lists todos", async () => {
  render(<Todos />, { wrapper: harness.Wrapper });
  expect(await screen.findByText("learn Effect")).toBeTruthy();
});
```

| field                 | use it to                                                                 |
| --------------------- | ------------------------------------------------------------------------- |
| `harness.Wrapper`     | wrap `render(ui, { wrapper })` and `renderHook`                           |
| `harness.registry`    | set atoms before rendering (Redux's `preloadedState`) and read them after |
| `harness.run(effect)` | run an Effect with the client and your services, as a Promise             |
| `harness.client`      | read the cache directly                                                   |
| `harness.runtime`     | the `ManagedRuntime`, for anything else                                   |
| `harness.dispose()`   | stop every fiber and dispose the registry                                 |

`dispose` can run before React Testing Library unmounts the tree, which is
the order Vitest uses (`afterEach` before the automatic cleanup).

`harness.run` makes query specs short, without rendering anything:

```ts
it("caches the list", async () => {
  await harness.run(Effect.flatMap(QueryClient.QueryClient, (c) => c.fetchQuery(todosQuery)));
  const cached = Effect.runSync(harness.client.getQueryData(todosQuery));
  expect(Option.isSome(cached)).toBe(true);
});
```

### Loading states

A fake that answers at once skips the loading state. `controlled()` gives a
response that stays pending until the test completes it:

```tsx
it("shows a spinner, then the error", async () => {
  const list = controlled<ReadonlyArray<Todo>, Offline>();
  harness = makeTestHarness({ layer: Layer.succeed(TodoRepo, TodoRepo.of({ list: list.effect })) });
  render(<Todos />, { wrapper: harness.Wrapper });
  expect(screen.getByText("Loading…")).toBeTruthy();

  await act(async () => list.fail(new Offline()));
  expect(await screen.findByText("You are offline")).toBeTruthy();
});
```

`succeed`, `fail` and `die` complete it, and the first completion wins.
Every run of `list.effect` waits for that same outcome, so a refetch gets it
too.

### Test defaults

The harness's client does not retry, does not refetch on window focus or
reconnect, and runs no garbage collection timers. Failures show at once and
nothing refetches unexpectedly. Override any of it with
`makeTestHarness({ client: { defaultOptions: { queries: { staleTime: "1 minute" } } } })`.

Without the harness, use the same defaults with `testQueryClientLayer()`
in place of `QueryClient.layer()`, or spread `testDefaultOptions`.

## Mocking hooks

To test a container component without a client, mock the hooks it uses.

### Mock a named hook, not `useQuery`

Export a small hook per query or mutation, and use it in components:

```ts
// todoApi.ts
export const useTodosQuery = () => useQuery(todosQuery);
export const useSaveTodo = () => useMutation(saveTodo);
```

A test can then replace exactly that hook. Mocking the generic `useQuery`
instead means one mock for every query in the tree, dispatching on which atom
it received.

Build the return values with `queryHookResult` and `mutationHookResult`.
They add the hook's functions (`refetch`, `mutate`, `mutateEffect`, `reset`)
to a result, so no cast is needed:

```ts
vi.mock("./todoApi", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./todoApi")>()),
  useTodosQuery: vi.fn(),
  useSaveTodo: vi.fn(),
}));

it("renders the list and saves", () => {
  const mutate = vi.fn();
  vi.mocked(useTodosQuery).mockReturnValue(queryHookResult(QueryResult.success([todo])));
  vi.mocked(useSaveTodo).mockReturnValue(mutationHookResult(MutationResult.idle(), { mutate }));
  render(<TodoList />);
  fireEvent.click(screen.getByText("Save"));
  expect(mutate).toHaveBeenCalledWith(todo);
});
```

`refetch`, `mutate` and `reset` do nothing unless you pass your own.
`mutateEffect` fails with a defect unless you pass one, so a component that
awaits it does not silently succeed.

The results come from constructors that set every flag the way a real query
or mutation does:

| constructor                            | state                                             |
| -------------------------------------- | ------------------------------------------------- |
| `QueryResult.idle()`                   | disabled (`enabled: false`): pending, not loading |
| `QueryResult.disabled()`               | skipped with `Query.skipToken`                    |
| `QueryResult.pending()`                | first load running (`isLoading`)                  |
| `QueryResult.success(data)`            | loaded                                            |
| `QueryResult.failure(error)`           | first load failed with a typed error              |
| `MutationResult.idle()`                | not run yet                                       |
| `MutationResult.pending(input)`        | running                                           |
| `MutationResult.success(data, input)`  | succeeded                                         |
| `MutationResult.failure(error, input)` | failed with a typed error                         |

Timestamps are `None`. Spread to change a flag:
`queryHookResult({ ...QueryResult.success(todos), isRefetching: true, isFetching: true })`.

### Mocking hooks from another module

Definitions live at module level, so a plain `invalidates` array is evaluated
when the module loads. If `planetApi.ts` invalidates `spaceshipKeys.all`, a test
that partially mocks `spaceshipApi.ts` crashes on import with
`No "spaceshipKeys" export is defined on the mock`. Two fixes:

- Use the function form for keys from other modules. It is read only when the
  mutation succeeds, so tests that never complete the mutation import fine.
  A test that does run it to success still reads the export: keep the real
  module there (next option), or mock `spaceshipKeys` too.

  ```ts
  export const deletePlanetMutation = Mutation.make({
    run: (id: string) => PlanetRepo.use((repo) => repo.delete(id)),
    invalidates: () => [planetKeys.all, spaceshipKeys.all],
  });
  ```

- Or keep the real module in partial mocks:

  ```ts
  vi.mock("./spaceshipApi", async (importOriginal) => ({
    ...(await importOriginal<typeof import("./spaceshipApi")>()),
    useGetSpaceshipByIdQuery: vi.fn(),
  }));
  ```

### Tracked properties

Tracked properties apply in tests too. A `renderHook` result only re-renders
for properties read during render, so read the ones you assert on inside the
hook callback, or pass `notifyOnChangeProps: "all"`.
