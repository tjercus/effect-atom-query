import { act, fireEvent, render, renderHook, screen, waitFor } from "@testing-library/react";
import { Effect, Option } from "effect";
import * as React from "react";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import {
  InfiniteQuery,
  Query,
  QueryClientProvider,
  QueryErrorResetBoundary,
  useInfiniteQuery,
  usePrefetchQuery,
  useQuery,
  useSuspenseInfiniteQuery,
  useSuspenseQueries,
  useSuspenseQuery,
} from "../src/index.ts";
import { counter, makeClient, RetryBoundary, wrapper } from "./utils.tsx";

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

describe("useSuspenseQuery", () => {
  it("suspends, then renders present data without refetching on mount", async () => {
    const { client } = setup();
    const runs = counter();
    const q = Query.single({
      key: ["suspense"],
      run: Effect.sync(runs.next).pipe(Effect.delay("20 millis")),
    });
    function Value() {
      const r = useSuspenseQuery(q);
      return <p>value {r.data.value}</p>; // no Option check: data is present
    }
    render(
      <QueryClientProvider client={client}>
        <React.Suspense fallback={<p>loading</p>}>
          <Value />
        </React.Suspense>
      </QueryClientProvider>,
    );
    expect(screen.getByText("loading")).toBeTruthy();
    expect(await screen.findByText("value 1")).toBeTruthy();
    await new Promise((r) => setTimeout(r, 50));
    expect(runs.count).toBe(1); // staleTime 0 is raised to 1s for suspense
  });

  it("throws errors to the boundary; reset() makes the retry refetch", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const { client } = setup();
    let fail = true;
    const runs = counter();
    const q = Query.single({
      key: ["suspense-error"],
      run: Effect.suspend(() => {
        runs.next();
        return fail ? Effect.fail("broken" as const) : Effect.succeed("fixed");
      }),
      retry: false,
    });
    function Value() {
      return <p>{useSuspenseQuery(q).data.value}</p>;
    }
    render(
      <QueryClientProvider client={client}>
        <QueryErrorResetBoundary>
          {({ reset }) => (
            <RetryBoundary onReset={reset}>
              <React.Suspense fallback={<p>loading</p>}>
                <Value />
              </React.Suspense>
            </RetryBoundary>
          )}
        </QueryErrorResetBoundary>
      </QueryClientProvider>,
    );
    expect(await screen.findByText("caught: broken")).toBeTruthy();
    fail = false;
    fireEvent.click(screen.getByText("retry"));
    expect(await screen.findByText("fixed")).toBeTruthy();
    expect(runs.count).toBe(2);
  });

  it("without reset, a remount rethrows instead of refetching", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const { client } = setup();
    const runs = counter();
    const q = Query.single({
      key: ["no-reset"],
      run: Effect.sync(runs.next).pipe(Effect.andThen(Effect.fail("broken" as const))),
      retry: false,
    });
    function Value() {
      return <p>{useSuspenseQuery(q).data.value}</p>;
    }
    render(
      <QueryClientProvider client={client}>
        <RetryBoundary>
          <React.Suspense fallback={<p>loading</p>}>
            <Value />
          </React.Suspense>
        </RetryBoundary>
      </QueryClientProvider>,
    );
    expect(await screen.findByText("caught: broken")).toBeTruthy();
    fireEvent.click(screen.getByText("retry")); // no reset()
    expect(await screen.findByText("caught: broken")).toBeTruthy();
    expect(runs.count).toBe(1);
  });

  it("useQuery with throwOnError uses the same boundary protocol", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const { client } = setup();
    let fail = true;
    const q = Query.single({
      key: ["throw-on-error"],
      run: Effect.suspend(() => (fail ? Effect.fail("nope" as const) : Effect.succeed("ok"))),
      retry: false,
    });
    function Value() {
      const r = useQuery(q, { throwOnError: true });
      return <p>{r.isSuccess ? r.data.value : "…"}</p>;
    }
    render(
      <QueryClientProvider client={client}>
        <QueryErrorResetBoundary>
          {({ reset }) => (
            <RetryBoundary onReset={reset}>
              <Value />
            </RetryBoundary>
          )}
        </QueryErrorResetBoundary>
      </QueryClientProvider>,
    );
    expect(await screen.findByText("caught: nope")).toBeTruthy();
    fail = false;
    fireEvent.click(screen.getByText("retry"));
    expect(await screen.findByText("ok")).toBeTruthy();
  });
});

describe("useSuspenseQueries", () => {
  it("fetches all queries in parallel and suspends until all have data", async () => {
    const { client } = setup();
    const started: Array<number> = [];
    const item = Query.make({
      key: (id: number) => ["item", id],
      run: (id) =>
        Effect.sync(() => started.push(id)).pipe(
          Effect.andThen(Effect.sleep("30 millis")),
          Effect.as(`item ${id}`),
        ),
    });
    function Items() {
      const titles = useSuspenseQueries({
        queries: [item(1), item(2)],
        combine: (results) => results.map((r) => Option.getOrElse(r.data, () => "?")).join(", "),
      });
      return <p>{titles}</p>;
    }
    render(
      <QueryClientProvider client={client}>
        <React.Suspense fallback={<p>loading</p>}>
          <Items />
        </React.Suspense>
      </QueryClientProvider>,
    );
    await waitFor(() => expect(started).toEqual([1, 2])); // both started before either finished
    expect(screen.getByText("loading")).toBeTruthy();
    expect(await screen.findByText("item 1, item 2")).toBeTruthy();
  });
});

describe("useInfiniteQuery", () => {
  const makeFeed = () =>
    InfiniteQuery.make({
      key: (name: string) => ["feed", name],
      run: (_name, cursor: number) =>
        Effect.succeed({
          items: [cursor, cursor + 1],
          next: cursor < 4 ? Option.some(cursor + 2) : Option.none<number>(),
        }).pipe(Effect.delay("10 millis")),
      initialPageParam: 0,
      getNextPageParam: (page) => page.next,
    });

  it("pages forward with hasNextPage / isFetchingNextPage", async () => {
    const { client } = setup();
    const feed = makeFeed();
    const { result } = renderHook(
      () => {
        const r = useInfiniteQuery(feed("all"), { select: (d) => d.pages.flatMap((p) => p.items) });
        // Read during render, as a component would, so it is tracked.
        void r.isFetchingNextPage;
        return r;
      },
      { wrapper: wrapper(client) },
    );
    await waitFor(() => expect(result.current.data).toEqual(Option.some([0, 1])));
    expect(result.current.hasNextPage).toBe(true);
    act(() => result.current.fetchNextPage());
    await waitFor(() => expect(result.current.isFetchingNextPage).toBe(true));
    await waitFor(() => expect(result.current.data).toEqual(Option.some([0, 1, 2, 3])));
    act(() => result.current.fetchNextPage());
    await waitFor(() => expect(result.current.data).toEqual(Option.some([0, 1, 2, 3, 4, 5])));
    expect(result.current.hasNextPage).toBe(false);
    expect(result.current.isFetchingNextPage).toBe(false);
  });

  it("has a suspense variant", async () => {
    const { client } = setup();
    const feed = makeFeed();
    function Feed() {
      const r = useSuspenseInfiniteQuery(feed("suspense"));
      return <p>pages {r.data.value.pages.length}</p>;
    }
    render(
      <QueryClientProvider client={client}>
        <React.Suspense fallback={<p>loading</p>}>
          <Feed />
        </React.Suspense>
      </QueryClientProvider>,
    );
    expect(await screen.findByText("pages 1")).toBeTruthy();
  });
});

describe("usePrefetchQuery", () => {
  it("starts the fetch in the parent so the suspending child joins it", async () => {
    const { client } = setup();
    const runs = counter();
    const q = Query.single({
      key: ["prefetch"],
      run: Effect.sync(runs.next).pipe(Effect.delay("20 millis")),
    });
    function Child() {
      return <p>child {useSuspenseQuery(q).data.value}</p>;
    }
    function Parent() {
      usePrefetchQuery(q);
      return (
        <React.Suspense fallback={<p>loading</p>}>
          <Child />
        </React.Suspense>
      );
    }
    render(
      <QueryClientProvider client={client}>
        <Parent />
      </QueryClientProvider>,
    );
    expect(await screen.findByText("child 1")).toBeTruthy();
    expect(runs.count).toBe(1);
  });
});
