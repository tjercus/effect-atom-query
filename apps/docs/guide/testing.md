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

## Components

Build a client on a `ManagedRuntime` with fake services and render inside
`QueryClientProvider`. Disposing the runtime stops every background fiber:

```tsx
const runtime = ManagedRuntime.make(QueryClient.layer().pipe(Layer.provideMerge(FakeRepo)));
render(
  <QueryClientProvider runtime={runtime}>
    <Todos />
  </QueryClientProvider>,
);
await screen.findByText("learn Effect");
await runtime.dispose();
```

### Mocking hooks from another module

Definitions live at module level, so a plain `invalidates` array is evaluated
when the module loads. If `planetApi.ts` invalidates `spaceshipKeys.all`, a test
that partially mocks `spaceshipApi.ts` crashes on import with
`No "spaceshipKeys" export is defined on the mock`. Two fixes:

- Use the function form for keys from other modules. It is read only when the
  mutation succeeds:

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
