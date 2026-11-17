import { act, render, renderHook, screen, waitFor } from "@testing-library/react";
import { useAtomValue } from "@effect/atom-react";
import { Effect, Option } from "effect";
import { Atom, AtomRegistry } from "effect/reactivity";
import * as React from "react";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import {
  MissingQueryClientProviderError,
  Query,
  queriesEntry,
  QueryClient,
  QueryClientProvider,
  useIsFetching,
  useQueries,
  useQuery,
  useQueryClient,
} from "../src/index.ts";
import { counter, ErrorBoundary, makeClient, wrapper } from "./utils.tsx";

const disposers: Array<() => Promise<void>> = [];
const setup = (options?: Parameters<typeof makeClient>[0]) => {
  const c = makeClient(options);
  disposers.push(c.dispose);
  return c;
};
afterEach(async () => {
  vi.restoreAllMocks();
  for (const dispose of disposers.splice(0)) {
    await dispose();
  }
});

describe("QueryClientProvider", () => {
  it("provides the client and binds it to the atom registry", async () => {
    const { client } = setup();
    const q = Query.single({ key: ["atom"], run: Effect.succeed("via atom") });
    function ViaAtom() {
      const r = useAtomValue(q);
      return <p>{r.isSuccess ? r.data.value : "…"}</p>;
    }
    const { result } = renderHook(() => useQueryClient(), { wrapper: wrapper(client) });
    expect(result.current).toBe(client);
    render(
      <QueryClientProvider client={client}>
        <ViaAtom />
      </QueryClientProvider>,
    );
    expect(await screen.findByText("via atom")).toBeTruthy();
  });

  it("accepts a ManagedRuntime", async () => {
    const { runtime, client } = setup();
    const { result } = renderHook(() => useQueryClient(), {
      wrapper: ({ children }) => (
        <QueryClientProvider runtime={runtime}>{children}</QueryClientProvider>
      ),
    });
    expect(result.current).toBe(client);
  });

  describe("with an existing registry", () => {
    it("binds the client into it and provides it to hooks", async () => {
      const { client } = setup();
      const registry = AtomRegistry.make();
      const user = Atom.make("anonymous");
      const q = Query.single({ key: ["shared-registry"], run: Effect.succeed("data") });
      function View() {
        const name = useAtomValue(user);
        const r = useQuery(q);
        return <p>{`${name}:${r.isSuccess ? r.data.value : "…"}`}</p>;
      }
      render(
        <QueryClientProvider client={client} registry={registry}>
          <View />
        </QueryClientProvider>,
      );
      expect(registry.get(QueryClient.current)).toEqual(Option.some(client));
      expect(await screen.findByText("anonymous:data")).toBeTruthy();

      // plain code writes to the same registry, outside React
      act(() => registry.set(user, "ada"));
      expect(await screen.findByText("ada:data")).toBeTruthy();
      // and reads query atoms from it
      const fromRegistry = registry.get(q);
      expect(fromRegistry.isSuccess && fromRegistry.data.value).toBe("data");
    });

    it("lets query atoms render through atom hooks on the first render", async () => {
      const { client } = setup();
      const registry = AtomRegistry.make();
      const q = Query.single({ key: ["shared-registry-atom"], run: Effect.succeed("via atom") });
      function ViaAtom() {
        const r = useAtomValue(q);
        return <p>{r.isSuccess ? r.data.value : "…"}</p>;
      }
      render(
        <QueryClientProvider client={client} registry={registry}>
          <ViaAtom />
        </QueryClientProvider>,
      );
      expect(await screen.findByText("via atom")).toBeTruthy();
    });

    it("rebinds when the client changes", () => {
      const a = setup();
      const b = setup();
      const registry = AtomRegistry.make();
      const { rerender } = render(<QueryClientProvider client={a.client} registry={registry} />);
      expect(registry.get(QueryClient.current)).toEqual(Option.some(a.client));
      rerender(<QueryClientProvider client={b.client} registry={registry} />);
      expect(registry.get(QueryClient.current)).toEqual(Option.some(b.client));
    });

    it("unbinds the client on unmount", async () => {
      const { client } = setup();
      const registry = AtomRegistry.make();
      const { unmount } = render(<QueryClientProvider client={client} registry={registry} />);
      unmount();
      await waitFor(() => expect(registry.get(QueryClient.current)).toEqual(Option.none()));
    });

    it("does not throw when the registry is disposed before the deferred unbind", () => {
      // Vitest runs a spec's afterEach (disposing the registry) before
      // testing-library's cleanup (unmounting the provider).
      vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
      try {
        const { client } = setup();
        const registry = AtomRegistry.make();
        const { unmount } = render(<QueryClientProvider client={client} registry={registry} />);
        registry.dispose();
        unmount();
        expect(() => vi.runAllTimers()).not.toThrow();
      } finally {
        vi.useRealTimers();
      }
    });

    it("stays bound when a new provider takes over before the deferred unbind", async () => {
      const { client } = setup();
      const registry = AtomRegistry.make();
      const first = render(<QueryClientProvider client={client} registry={registry} />);
      first.unmount();
      render(<QueryClientProvider client={client} registry={registry} />);
      await new Promise((r) => setTimeout(r, 20)); // past the first provider's unbind
      expect(registry.get(QueryClient.current)).toEqual(Option.some(client));
    });

    it("unbinds the previous registry when the registry changes", async () => {
      const { client } = setup();
      const a = AtomRegistry.make();
      const b = AtomRegistry.make();
      const { rerender } = render(<QueryClientProvider client={client} registry={a} />);
      rerender(<QueryClientProvider client={client} registry={b} />);
      await new Promise((r) => setTimeout(r, 20));
      expect(a.get(QueryClient.current)).toEqual(Option.none());
      expect(b.get(QueryClient.current)).toEqual(Option.some(client));
    });

    it("replaces a client left behind by no committed provider on the first render", () => {
      const stale = setup();
      const { client } = setup();
      const registry = AtomRegistry.make();
      // e.g. bound by a provider whose first render was discarded
      registry.set(QueryClient.current, Option.some(stale.client));
      const seen: Array<QueryClient.Service | undefined> = [];
      function View() {
        seen.push(Option.getOrUndefined(useAtomValue(QueryClient.current)));
        return null;
      }
      render(
        <QueryClientProvider client={client} registry={registry}>
          <View />
        </QueryClientProvider>,
      );
      expect(seen[0]).toBe(client);
    });

    it("stays bound under StrictMode", async () => {
      const { client } = setup();
      const registry = AtomRegistry.make();
      const runs = counter();
      const q = Query.single({
        key: ["shared-registry-strict"],
        run: Effect.sync(() => runs.next()),
      });
      function View() {
        const r = useQuery(q);
        return <p>{r.isSuccess ? `run ${r.data.value}` : "…"}</p>;
      }
      render(
        <React.StrictMode>
          <QueryClientProvider client={client} registry={registry}>
            <View />
          </QueryClientProvider>
        </React.StrictMode>,
      );
      expect(await screen.findByText(/^run \d$/)).toBeTruthy();
      await new Promise((r) => setTimeout(r, 20)); // past the deferred unbind
      expect(registry.get(QueryClient.current)).toEqual(Option.some(client));
    });

    it("warns when two providers share one registry", () => {
      const error = vi.spyOn(console, "error").mockImplementation(() => {});
      const a = setup();
      const b = setup();
      const registry = AtomRegistry.make();
      render(
        <QueryClientProvider client={a.client} registry={registry}>
          <QueryClientProvider client={b.client} registry={registry} />
        </QueryClientProvider>,
      );
      expect(error).toHaveBeenCalledWith(expect.stringContaining("share one AtomRegistry"));
    });

    it("accepts a ManagedRuntime", () => {
      const { runtime, client } = setup();
      const registry = AtomRegistry.make();
      const { result } = renderHook(() => useQueryClient(), {
        wrapper: ({ children }) => (
          <QueryClientProvider runtime={runtime} registry={registry}>
            {children}
          </QueryClientProvider>
        ),
      });
      expect(result.current).toBe(client);
      expect(registry.get(QueryClient.current)).toEqual(Option.some(client));
    });
  });

  it("throws a helpful error without a provider", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    expect(() => renderHook(() => useQueryClient())).toThrow(MissingQueryClientProviderError);
  });
});

describe("useQuery", () => {
  it("goes from loading to success, optimistically fetching on the first render", async () => {
    const { client } = setup();
    const q = Query.single({
      key: ["basic"],
      run: Effect.succeed("hello").pipe(Effect.delay("10 millis")),
    });
    const states: Array<string> = [];
    const { result } = renderHook(
      () => {
        const r = useQuery(q);
        states.push(`${r.status}/${r.fetchStatus}`);
        return r;
      },
      { wrapper: wrapper(client) },
    );
    expect(states[0]).toBe("pending/fetching");
    expect(result.current.isLoading).toBe(true);
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual(Option.some("hello"));
    expect(result.current.isFetchedAfterMount).toBe(true);
    expect(states).not.toContain("pending/idle");
  });

  it("fetches once in StrictMode", async () => {
    const { client } = setup();
    const runs = counter();
    const q = Query.single({ key: ["strict"], run: Effect.sync(runs.next) });
    const { result } = renderHook(() => useQuery(q), {
      wrapper: ({ children }) => (
        <React.StrictMode>
          <QueryClientProvider client={client}>{children}</QueryClientProvider>
        </React.StrictMode>
      ),
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(runs.count).toBe(1);
  });

  it("refetches stale data when another component mounts", async () => {
    const { client } = setup();
    const runs = counter();
    const q = Query.single({ key: ["per-mount"], run: Effect.sync(runs.next) });
    function Item() {
      const r = useQuery(q);
      return <p>{r.isSuccess ? `n=${r.data.value}` : "…"}</p>;
    }
    function App({ two }: { readonly two: boolean }) {
      return (
        <QueryClientProvider client={client}>
          <Item />
          {two ? <Item /> : null}
        </QueryClientProvider>
      );
    }
    const view = render(<App two={false} />);
    expect(await screen.findByText("n=1")).toBeTruthy();
    view.rerender(<App two />);
    await waitFor(() => expect(screen.getAllByText("n=2")).toHaveLength(2));
    expect(runs.count).toBe(2);
  });

  it("does not refetch fresh data on mount", async () => {
    const { client } = setup();
    const runs = counter();
    const q = Query.single({ key: ["fresh"], run: Effect.sync(runs.next), staleTime: "1 minute" });
    const first = renderHook(() => useQuery(q), { wrapper: wrapper(client) });
    await waitFor(() => expect(first.result.current.isSuccess).toBe(true));
    const second = renderHook(() => useQuery(q), { wrapper: wrapper(client) });
    expect(second.result.current.isFetching).toBe(false);
    expect(second.result.current.isFetchedAfterMount).toBe(false);
    expect(runs.count).toBe(1);
  });

  it("applies select per component and keeps its result stable", async () => {
    const { client } = setup();
    const q = Query.single({
      key: ["select"],
      run: Effect.succeed({ title: "a", items: [1, 2, 3] }),
    });
    const select = (d: { readonly items: ReadonlyArray<number> }) => d.items.length;
    const { result, rerender } = renderHook(() => useQuery(q, { select }), {
      wrapper: wrapper(client),
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    const first = result.current;
    expect(first.data).toEqual(Option.some(3));
    rerender();
    expect(result.current).toBe(first);
  });

  it("shows placeholder data while pending, and keeps previous data across keys", async () => {
    const { client } = setup();
    const page = Query.make({
      key: (n: number) => ["page", n],
      run: (n) => Effect.succeed(`page ${n}`).pipe(Effect.delay("20 millis")),
    });
    const { result, rerender } = renderHook(
      ({ n }: { n: number }) => useQuery(page(n), { placeholderData: Query.keepPreviousData }),
      { wrapper: wrapper(client), initialProps: { n: 1 } },
    );
    expect(result.current.status).toBe("pending"); // nothing to keep yet
    await waitFor(() => expect(result.current.data).toEqual(Option.some("page 1")));
    rerender({ n: 2 });
    expect(result.current.isPlaceholderData).toBe(true);
    expect(result.current.data).toEqual(Option.some("page 1"));
    expect(result.current.isFetching).toBe(true);
    await waitFor(() => expect(result.current.data).toEqual(Option.some("page 2")));
    expect(result.current.isPlaceholderData).toBe(false);

    const fixed = renderHook(() => useQuery(page(3), { placeholderData: "placeholder" }), {
      wrapper: wrapper(client),
    });
    expect(fixed.result.current).toMatchObject({ isSuccess: true, isPlaceholderData: true });
    expect(fixed.result.current.data).toEqual(Option.some("placeholder"));
  });

  it("uses initialData and types data as present", async () => {
    const { client } = setup();
    const runs = counter();
    const q = Query.single({
      key: ["initial"],
      run: Effect.sync(() => `fetched ${runs.next()}`),
      initialData: () => "initial",
      staleTime: "1 minute",
    });
    const { result } = renderHook(() => useQuery(q), { wrapper: wrapper(client) });
    const value: string = result.current.data.value; // DefinedUseQueryResult: no Option check needed
    expect(value).toBe("initial");
    expect(result.current.isFetching).toBe(false);
    expect(runs.count).toBe(0);
  });

  it("respects a per-component enabled flag and fetches once enabled", async () => {
    const { client } = setup();
    const runs = counter();
    const q = Query.single({ key: ["lazy"], run: Effect.sync(runs.next) });
    const { result, rerender } = renderHook(
      ({ enabled }: { enabled: boolean }) => useQuery(q, { enabled }),
      {
        wrapper: wrapper(client),
        initialProps: { enabled: false },
      },
    );
    expect(result.current).toMatchObject({
      status: "pending",
      fetchStatus: "idle",
      isEnabled: false,
    });
    await new Promise((r) => setTimeout(r, 10));
    expect(runs.count).toBe(0);
    rerender({ enabled: true });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(runs.count).toBe(1);
  });

  it("supports skipToken", () => {
    const { client } = setup();
    const todo = Query.make({ key: (id: number) => ["todo", id], run: (id) => Effect.succeed(id) });
    const { result } = renderHook(
      ({ id }: { id: number | undefined }) => useQuery(todo(id ?? Query.skipToken)),
      { wrapper: wrapper(client), initialProps: { id: undefined as number | undefined } },
    );
    expect(result.current).toMatchObject({
      status: "pending",
      fetchStatus: "idle",
      isEnabled: false,
    });
  });

  it("tolerates a new atom with the same key on every render", async () => {
    const { client } = setup();
    const runs = counter();
    const { result } = renderHook(
      () => useQuery(Query.single({ key: ["inline"], run: Effect.sync(runs.next) })),
      { wrapper: wrapper(client) },
    );
    await waitFor(() => expect(result.current.data).toEqual(Option.some(1)));
    await new Promise((r) => setTimeout(r, 20));
    expect(runs.count).toBe(1);
  });

  it("refetch() forces a new fetch", async () => {
    const { client } = setup();
    const runs = counter();
    const q = Query.single({ key: ["refetch"], run: Effect.sync(runs.next), staleTime: "static" });
    const { result } = renderHook(() => useQuery(q), { wrapper: wrapper(client) });
    await waitFor(() => expect(result.current.data).toEqual(Option.some(1)));
    act(() => result.current.refetch());
    await waitFor(() => expect(result.current.data).toEqual(Option.some(2)));
  });

  it("throws defects to the error boundary, typed errors only with throwOnError", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const { client } = setup();
    const defect = Query.single({ key: ["defect"], run: Effect.die("kaboom") });
    const failing = Query.single({
      key: ["typed"],
      run: Effect.fail("nope" as const),
      retry: false,
    });
    function Defect() {
      useQuery(defect);
      return <p>no throw</p>;
    }
    function Typed({ rethrow }: { readonly rethrow: boolean }) {
      const r = useQuery(failing, { throwOnError: rethrow });
      return <p>{r.isError ? `error: ${Option.getOrThrow(r.error)}` : "…"}</p>;
    }
    render(
      <QueryClientProvider client={client}>
        <ErrorBoundary>
          <Defect />
        </ErrorBoundary>
        <ErrorBoundary>
          <Typed rethrow={false} />
        </ErrorBoundary>
      </QueryClientProvider>,
    );
    expect(await screen.findByText("caught: kaboom")).toBeTruthy();
    expect(await screen.findByText("error: nope")).toBeTruthy();

    render(
      <QueryClientProvider client={client}>
        <ErrorBoundary>
          <Typed rethrow />
        </ErrorBoundary>
      </QueryClientProvider>,
    );
    expect(await screen.findByText("caught: nope")).toBeTruthy();
  });
});

describe("useQueries", () => {
  it("observes a dynamic list and combines results", async () => {
    const { client } = setup();
    const todo = Query.make({
      key: (id: number) => ["todo", id],
      run: (id) => Effect.succeed({ id, title: `todo ${id}` }).pipe(Effect.delay("5 millis")),
    });
    const { result, rerender } = renderHook(
      ({ ids }: { ids: ReadonlyArray<number> }) =>
        useQueries({
          queries: ids.map((id) => queriesEntry(todo(id), { select: (t) => t.title })),
          combine: (results) => ({
            pending: results.some((r) => r.isPending),
            titles: results.flatMap((r) => (r.isSuccess ? [r.data.value] : [])),
          }),
        }),
      { wrapper: wrapper(client), initialProps: { ids: [1, 2] } },
    );
    expect(result.current.pending).toBe(true);
    await waitFor(() => expect(result.current.titles).toEqual(["todo 1", "todo 2"]));
    rerender({ ids: [1, 2, 3] });
    await waitFor(() => expect(result.current.titles).toEqual(["todo 1", "todo 2", "todo 3"]));
    rerender({ ids: [3] });
    await waitFor(() => expect(result.current.titles).toEqual(["todo 3"]));
  });

  it("returns results unchanged when nothing changed", async () => {
    const { client } = setup();
    const a = Query.single({ key: ["a"], run: Effect.succeed(1) });
    const b = Query.single({ key: ["b"], run: Effect.succeed("b") });
    const { result, rerender } = renderHook(() => useQueries({ queries: [a, b] as const }), {
      wrapper: wrapper(client),
    });
    await waitFor(() => expect(result.current.every((r) => r.isSuccess)).toBe(true));
    const first = result.current;
    const n: Option.Option<number> = first[0].data;
    expect(n).toEqual(Option.some(1));
    rerender();
    expect(result.current).toBe(first);
  });
});

describe("useIsFetching", () => {
  it("counts fetching queries, filterable by key", async () => {
    const { client } = setup();
    const slow = Query.make({
      key: (id: number) => ["slow", id],
      run: (id) => Effect.succeed(id).pipe(Effect.delay("20 millis")),
    });
    const { result } = renderHook(
      () => {
        useQuery(slow(1));
        useQuery(slow(2));
        return { all: useIsFetching(), one: useIsFetching({ queryKey: ["slow", 1] }) };
      },
      { wrapper: wrapper(client) },
    );
    await waitFor(() => expect(result.current).toEqual({ all: 2, one: 1 }));
    await waitFor(() => expect(result.current).toEqual({ all: 0, one: 0 }));
  });
});
