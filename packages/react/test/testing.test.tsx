import { act, render, renderHook, screen } from "@testing-library/react";
import { useAtomValue } from "@effect/atom-react";
import { Cause, Context, Effect, Exit, Fiber, Layer, Option } from "effect";
import { Atom } from "effect/reactivity";
import * as React from "react";
import { afterEach, describe, expect, expectTypeOf, it, vi } from "@effect/vitest";
import {
  type DefinedUseQueryResult,
  MutationResult,
  Query,
  QueryClient,
  QueryResult,
  type UseMutationResult,
  type UseQueryResult,
  useQuery,
} from "../src/index.ts";
import {
  controlled,
  makeTestHarness,
  mutationHookResult,
  queryHookResult,
  type TestHarness,
  testQueryClientLayer,
} from "../src/testing.tsx";

class TodoRepo extends Context.Service<
  TodoRepo,
  { readonly list: Effect.Effect<ReadonlyArray<string>, "Offline"> }
>()("test/TodoRepo") {}

const todosQuery = Query.single({
  key: ["testing-todos"],
  run: Effect.flatMap(TodoRepo, (repo) => repo.list),
});

const harnesses: Array<TestHarness<any, any>> = [];
const harness = <R, E>(options?: Parameters<typeof makeTestHarness<R, E>>[0]) => {
  const h = makeTestHarness(options);
  harnesses.push(h);
  return h;
};
afterEach(async () => {
  for (const h of harnesses.splice(0)) {
    await h.dispose();
  }
});

function Todos() {
  const todos = useQuery(todosQuery);
  if (todos.isPending) {
    return <p>Loading…</p>;
  }
  if (todos.isError) {
    return <p>Failed</p>;
  }
  return <p>{todos.data.value.join(", ")}</p>;
}

describe("queryHookResult", () => {
  it("adds a no-op refetch and keeps the narrow result type", () => {
    const result = queryHookResult(QueryResult.success([1, 2]));
    expect(result.data).toEqual(Option.some([1, 2]));
    expect(() => result.refetch()).not.toThrow();
    expectTypeOf(result).toExtend<UseQueryResult<Array<number>, never>>();
    expectTypeOf(result).toExtend<DefinedUseQueryResult<Array<number>, never>>();
  });

  it("takes a refetch override", () => {
    const refetch = vi.fn();
    queryHookResult(QueryResult.idle(), { refetch }).refetch();
    expect(refetch).toHaveBeenCalledOnce();
  });

  it("keeps the default refetch when the override is undefined", () => {
    const result = queryHookResult(QueryResult.idle(), { refetch: undefined });
    expect(typeof result.refetch).toBe("function");
  });
});

describe("mutationHookResult", () => {
  it("keeps the defaults when overrides are undefined", () => {
    const result = mutationHookResult(MutationResult.idle<string, never, string>(), {
      mutate: undefined,
      reset: undefined,
    });
    expect(typeof result.mutate).toBe("function");
    expect(typeof result.reset).toBe("function");
  });

  it("adds no-op mutate and reset", () => {
    const result = mutationHookResult(MutationResult.idle<string, never, string>());
    expect(result.isIdle).toBe(true);
    expect(() => result.mutate("x")).not.toThrow();
    expect(() => result.reset()).not.toThrow();
  });

  it.effect("makes an unmocked mutateEffect fail with a defect", () =>
    Effect.gen(function* () {
      const result = mutationHookResult(MutationResult.idle<string, never, string>());
      const exit = yield* Effect.exit(result.mutateEffect("x"));
      expect(Exit.isFailure(exit) && Cause.hasDies(exit.cause)).toBe(true);
    }),
  );

  it("takes overrides, typed from the mocked hook", () => {
    const mutate = vi.fn();
    const useSave: () => UseMutationResult<number, "Invalid", string, unknown, never> = () =>
      mutationHookResult(MutationResult.pending("draft"), { mutate });
    const result = useSave();
    result.mutate("again");
    expect(mutate).toHaveBeenCalledWith("again");
    expect(result.isPending).toBe(true);
  });
});

describe("controlled", () => {
  it.effect("stays pending until succeeded", () =>
    Effect.gen(function* () {
      const response = controlled<number>();
      const fiber = yield* Effect.forkChild(response.effect);
      yield* Effect.yieldNow;
      expect(fiber.pollUnsafe()).toBeUndefined();
      expect(response.isDone()).toBe(false);
      response.succeed(1);
      expect(yield* Fiber.join(fiber)).toBe(1);
      expect(response.isDone()).toBe(true);
    }),
  );

  it.effect("fails and dies, and the first completion wins", () =>
    Effect.gen(function* () {
      const failing = controlled<number, "Nope">();
      failing.fail("Nope");
      failing.succeed(2);
      expect(yield* Effect.exit(failing.effect)).toEqual(Exit.fail("Nope"));

      const dying = controlled<number>();
      dying.die("boom");
      const died = yield* Effect.exit(dying.effect);
      expect(Exit.isFailure(died) && Cause.hasDies(died.cause)).toBe(true);
    }),
  );
});

describe("testQueryClientLayer", () => {
  it("applies test defaults, with options merged over them", async () => {
    const h = harness({ client: { defaultOptions: { queries: { staleTime: "1 minute" } } } });
    const defaults = await h.run(
      Effect.flatMap(QueryClient.QueryClient, (c) => c.getQueryDefaults(["any"])),
    );
    expect(defaults.retry).toBe(false);
    expect(defaults.refetchOnWindowFocus).toBe(false);
    expect(defaults.refetchOnReconnect).toBe(false);
    expect(defaults.gcTime).toBe("Infinity");
    expect(defaults.staleTime).toBe("1 minute");
  });

  it.effect("lets options override a test default", () =>
    Effect.gen(function* () {
      const client = yield* QueryClient.QueryClient;
      const defaults = yield* client.getQueryDefaults(["any"]);
      expect(defaults.retry).toBe(2);
      expect(defaults.refetchOnWindowFocus).toBe(false);
    }).pipe(Effect.provide(testQueryClientLayer({ defaultOptions: { queries: { retry: 2 } } }))),
  );
});

describe("makeTestHarness", () => {
  it("renders with fake services", async () => {
    const h = harness({
      layer: Layer.succeed(TodoRepo, TodoRepo.of({ list: Effect.succeed(["learn Effect"]) })),
    });
    render(<Todos />, { wrapper: h.Wrapper });
    expect(await screen.findByText("learn Effect")).toBeTruthy();
  });

  it("shows loading states with a controlled response", async () => {
    const list = controlled<ReadonlyArray<string>, "Offline">();
    const h = harness({ layer: Layer.succeed(TodoRepo, TodoRepo.of({ list: list.effect })) });
    render(<Todos />, { wrapper: h.Wrapper });
    expect(screen.getByText("Loading…")).toBeTruthy();
    await act(async () => list.fail("Offline"));
    expect(await screen.findByText("Failed")).toBeTruthy(); // no retries in tests
  });

  it("shares its registry with atom hooks, like preloaded state", async () => {
    const filter = Atom.make("all");
    const h = harness();
    h.registry.set(filter, "open");
    const { result } = renderHook(() => useAtomValue(filter), { wrapper: h.Wrapper });
    expect(result.current).toBe("open");
  });

  it("runs Effects with the client and the services", async () => {
    const h = harness({
      layer: Layer.succeed(TodoRepo, TodoRepo.of({ list: Effect.succeed(["a"]) })),
    });
    expect(
      await h.run(Effect.flatMap(QueryClient.QueryClient, (c) => c.fetchQuery(todosQuery))),
    ).toEqual(["a"]);
    expect(await h.run(h.client.getQueryData(todosQuery))).toEqual(Option.some(["a"]));
  });

  it("can be disposed before the tree unmounts", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    try {
      const h = makeTestHarness();
      const { unmount } = render(<p>tree</p>, { wrapper: h.Wrapper });
      await h.dispose();
      unmount();
      expect(() => vi.runAllTimers()).not.toThrow();
    } finally {
      vi.useRealTimers();
    }
  });
});

void React;
