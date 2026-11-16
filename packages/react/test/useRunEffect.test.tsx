import { act, renderHook, waitFor } from "@testing-library/react";
import { Cause, Context, Data, Effect, Exit, Layer, ManagedRuntime, Option } from "effect";
import * as React from "react";
import { afterEach, describe, expect, it } from "vite-plus/test";
import {
  Mutation,
  Query,
  QueryClient,
  QueryClientProvider,
  useMutation,
  useRunEffect,
} from "../src/index.ts";
import { makeClient, wrapper } from "./utils.tsx";

class Greeter extends Context.Service<Greeter, { readonly greet: (name: string) => string }>()(
  "test/Greeter",
) {}

class NotFound extends Data.TaggedError("NotFound")<{ readonly message: string }> {}

const disposers: Array<() => Promise<void>> = [];
afterEach(async () => {
  for (const dispose of disposers.splice(0)) await dispose();
});
const setup = () => {
  const c = makeClient();
  disposers.push(c.dispose);
  return c;
};
const withGreeter = () => {
  const runtime = ManagedRuntime.make(
    QueryClient.layer().pipe(
      Layer.provideMerge(Layer.succeed(Greeter, Greeter.of({ greet: (name) => `hi ${name}` }))),
    ),
  );
  disposers.push(() => runtime.dispose());
  return runtime;
};

const greet = (name: string) => Effect.map(Greeter, (g) => g.greet(name));

describe("useRunEffect", () => {
  describe("promiseExit", () => {
    it("resolves with a success Exit", async () => {
      const { client } = setup();
      const { result } = renderHook(() => useRunEffect(), { wrapper: wrapper(client) });
      const exit = await result.current.promiseExit(Effect.succeed(1));
      expect(exit).toEqual(Exit.succeed(1));
    });

    it("resolves (never rejects) with a typed failure", async () => {
      const { client } = setup();
      const { result } = renderHook(() => useRunEffect(), { wrapper: wrapper(client) });
      const exit = await result.current.promiseExit(Effect.fail(new NotFound({ message: "gone" })));
      expect(Exit.isFailure(exit)).toBe(true);
      const error = Exit.isFailure(exit) ? Cause.findErrorOption(exit.cause) : Option.none();
      expect(Option.getOrThrow(error)).toBeInstanceOf(NotFound);
    });

    it("resolves with a defect", async () => {
      const { client } = setup();
      const { result } = renderHook(() => useRunEffect(), { wrapper: wrapper(client) });
      const exit = await result.current.promiseExit(Effect.die("boom"));
      expect(Exit.isFailure(exit) && Cause.hasDies(exit.cause)).toBe(true);
    });

    it("interrupts when the signal aborts", async () => {
      const { client } = setup();
      const { result } = renderHook(() => useRunEffect(), { wrapper: wrapper(client) });
      const controller = new AbortController();
      const pending = result.current.promiseExit(Effect.never, { signal: controller.signal });
      controller.abort();
      const exit = await pending;
      expect(Exit.isFailure(exit) && Cause.hasInterruptsOnly(exit.cause)).toBe(true);
    });

    it("does not start the Effect when the signal is already aborted", async () => {
      const { client } = setup();
      const { result } = renderHook(() => useRunEffect(), { wrapper: wrapper(client) });
      let started = false;
      const exit = await result.current.promiseExit(
        Effect.sync(() => {
          started = true;
        }),
        { signal: AbortSignal.abort() },
      );
      expect(started).toBe(false);
      expect(Exit.isFailure(exit) && Cause.hasInterruptsOnly(exit.cause)).toBe(true);
    });
  });

  describe("promise", () => {
    it("resolves with the value", async () => {
      const { client } = setup();
      const { result } = renderHook(() => useRunEffect(), { wrapper: wrapper(client) });
      await expect(result.current.promise(Effect.succeed("ok"))).resolves.toBe("ok");
    });

    it("rejects with the typed error itself", async () => {
      const { client } = setup();
      const { result } = renderHook(() => useRunEffect(), { wrapper: wrapper(client) });
      const error = new NotFound({ message: "gone" });
      await expect(result.current.promise(Effect.fail(error))).rejects.toBe(error);
    });
  });

  describe("context", () => {
    it("provides the QueryClient", async () => {
      const { client } = setup();
      const { result } = renderHook(() => useRunEffect(), { wrapper: wrapper(client) });
      const q = Query.single({ key: ["run-effect"], run: Effect.succeed(42) });
      const value = await result.current.promise(
        Effect.flatMap(QueryClient.QueryClient, (c) => c.fetchQuery(q)),
      );
      expect(value).toBe(42);
      expect(Option.getOrThrow(Effect.runSync(client.getQueryData(q)))).toBe(42);
    });

    it("runs with the services of the provider's runtime", async () => {
      const runtime = withGreeter();
      const { result } = renderHook(() => useRunEffect<Greeter>(), {
        wrapper: ({ children }) => (
          <QueryClientProvider runtime={runtime}>{children}</QueryClientProvider>
        ),
      });
      await expect(result.current.promise(greet("ada"))).resolves.toBe("hi ada");
    });

    it("runs with the services of the layer a provided client was built in", async () => {
      const runtime = withGreeter();
      const client = runtime.runSync(QueryClient.QueryClient);
      const { result } = renderHook(() => useRunEffect<Greeter>(), { wrapper: wrapper(client) });
      await expect(result.current.promise(greet("bob"))).resolves.toBe("hi bob");
    });
  });

  it("is stable across renders", () => {
    const { client } = setup();
    const { result, rerender } = renderHook(() => useRunEffect(), { wrapper: wrapper(client) });
    const first = result.current;
    rerender();
    expect(result.current).toBe(first);
  });

  it("runs mutateEffect with the hook's state", async () => {
    const { client } = setup();
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const save = Mutation.make({
      run: (title: string) => Effect.promise(() => gate).pipe(Effect.as(title.toUpperCase())),
    });
    const { result } = renderHook(() => ({ run: useRunEffect(), save: useMutation(save) }), {
      wrapper: wrapper(client),
    });
    let pending!: Promise<Exit.Exit<string, never>>;
    act(() => {
      pending = result.current.run.promiseExit(result.current.save.mutateEffect("draft"));
    });
    await waitFor(() => expect(result.current.save.isPending).toBe(true));
    release();
    expect(await pending).toEqual(Exit.succeed("DRAFT"));
    await waitFor(() => expect(result.current.save.isSuccess).toBe(true));
    expect(Option.getOrThrow(result.current.save.data)).toBe("DRAFT");
  });
});

// Keeps React in scope for the JSX in wrappers.
void React;
