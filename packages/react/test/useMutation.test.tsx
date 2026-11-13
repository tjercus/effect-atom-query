import { act, renderHook, waitFor } from "@testing-library/react";
import { type Duration, Effect, Option } from "effect";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import {
  Mutation,
  Query,
  useIsMutating,
  useMutation,
  useMutationState,
  useQuery,
} from "../src/index.ts";
import { makeClient, wrapper } from "./utils.tsx";

const disposers: Array<() => Promise<void>> = [];
afterEach(async () => {
  vi.restoreAllMocks();
  for (const dispose of disposers.splice(0)) await dispose();
});
const setup = () => {
  const c = makeClient();
  disposers.push(c.dispose);
  return c;
};

const makeTodos = (delay: Duration.Input = "20 millis") => {
  let todos: ReadonlyArray<string> = ["a"];
  const todosQuery = Query.single({
    key: ["todos"],
    run: Effect.sync(() => todos),
    staleTime: "1 minute",
  });
  const addTodo = Mutation.make({
    key: ["todos", "add"],
    run: (title: string) =>
      Effect.sync(() => {
        todos = [...todos, title];
        return title;
      }).pipe(Effect.delay(delay)),
    invalidates: [["todos"]],
  });
  return { todosQuery, addTodo };
};

describe("useMutation", () => {
  it("runs, invalidates the list, and reports per-call callbacks", async () => {
    const { client } = setup();
    const { todosQuery, addTodo } = makeTodos();
    const onSuccess = vi.fn();
    const { result } = renderHook(
      () => ({ todos: useQuery(todosQuery), add: useMutation(addTodo, { onSuccess }) }),
      { wrapper: wrapper(client) },
    );
    await waitFor(() => expect(result.current.todos.data).toEqual(Option.some(["a"])));
    expect(result.current.add.isIdle).toBe(true);

    const perCall = vi.fn();
    act(() => result.current.add.mutate("b", { onSettled: perCall }));
    expect(result.current.add).toMatchObject({ status: "pending", variables: Option.some("b") });
    await waitFor(() => expect(result.current.add.isSuccess).toBe(true));
    expect(result.current.todos.data).toEqual(Option.some(["a", "b"])); // refetched before success
    expect(onSuccess).toHaveBeenCalledWith("b", "b");
    expect(perCall).toHaveBeenCalledTimes(1);

    act(() => result.current.add.reset());
    expect(result.current.add.isIdle).toBe(true);
  });

  it("mutateEffect runs with the caller's services and returns the value", async () => {
    const { client, runtime } = setup();
    const double = Mutation.make({ run: (n: number) => Effect.succeed(n * 2) });
    const { result } = renderHook(() => useMutation(double), { wrapper: wrapper(client) });
    let value = 0;
    await act(async () => {
      value = await runtime.runPromise(result.current.mutateEffect(21));
    });
    expect(value).toBe(42);
    await waitFor(() => expect(result.current.data).toEqual(Option.some(42)));
  });

  it("mutate takes no argument for void mutations", async () => {
    const { client } = setup();
    const ping = Mutation.make({ run: () => Effect.succeed("pong") });
    const { result } = renderHook(() => useMutation(ping), { wrapper: wrapper(client) });
    act(() => result.current.mutate());
    await waitFor(() => expect(result.current.data).toEqual(Option.some("pong")));
  });

  it("exposes typed errors, throwing only defects by default", async () => {
    const { client } = setup();
    const failing = Mutation.make({
      run: (input: string) => Effect.fail(`nope ${input}` as const),
    });
    const { result } = renderHook(() => useMutation(failing), { wrapper: wrapper(client) });
    act(() => result.current.mutate("x"));
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.error).toEqual(Option.some("nope x"));
  });
});

describe("useMutationState / useIsMutating", () => {
  it("shows pending variables for optimistic UIs and counts pending mutations", async () => {
    const { client } = setup();
    const { todosQuery, addTodo } = makeTodos();
    const { result } = renderHook(
      () => ({
        todos: useQuery(todosQuery),
        add: useMutation(addTodo),
        pending: useMutationState({
          filters: { mutation: addTodo, status: "pending" },
          select: (m) => Option.getOrThrow(m.variables) as string,
        }),
        mutating: useIsMutating({ mutationKey: ["todos"] }),
      }),
      { wrapper: wrapper(client) },
    );
    await waitFor(() => expect(result.current.todos.isSuccess).toBe(true));
    act(() => {
      result.current.add.mutate("b");
      result.current.add.mutate("c");
    });
    await waitFor(() => expect(result.current.pending).toEqual(["b", "c"]));
    expect(result.current.mutating).toBe(2);
    await waitFor(() => expect(result.current.mutating).toBe(0));
    expect(result.current.pending).toEqual([]);
    expect(result.current.todos.data).toEqual(Option.some(["a", "b", "c"]));
  });

  it("Mutation.optimistic works through useAtomValue", async () => {
    const { client } = setup();
    const { todosQuery, addTodo } = makeTodos("300 millis");
    const view = Mutation.optimistic(todosQuery, addTodo, (list, title) => [...list, `${title}…`]);
    const { useAtomValue } = await import("@effect/atom-react");
    const { result } = renderHook(() => ({ view: useAtomValue(view), add: useMutation(addTodo) }), {
      wrapper: wrapper(client),
    });
    await waitFor(() => expect(result.current.view.data).toEqual(Option.some(["a"])));
    act(() => result.current.add.mutate("b"));
    await waitFor(() => expect(result.current.view.data).toEqual(Option.some(["a", "b…"])));
    await waitFor(() => expect(result.current.view.data).toEqual(Option.some(["a", "b"])));
  });
});
