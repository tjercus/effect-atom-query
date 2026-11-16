import { act, render, screen, waitFor } from "@testing-library/react";
import { Effect, Option } from "effect";
import * as React from "react";
import { afterEach, describe, expect, it } from "vite-plus/test";
import {
  InfiniteQuery,
  Query,
  type UseQueryOptions,
  useInfiniteQuery,
  useQuery,
} from "../src/index.ts";
import { makeClient, wrapper } from "./utils.tsx";

const disposers: Array<() => Promise<void>> = [];
const setup = () => {
  const c = makeClient();
  disposers.push(c.dispose);
  return c;
};
afterEach(async () => {
  for (const dispose of disposers.splice(0)) {
    await dispose();
  }
});

/** A query returning the same value on every fetch, so only fetch flags change. */
const stableQuery = (key: string) =>
  Query.single({
    key: [key],
    run: Effect.succeed({ title: "same" }).pipe(Effect.delay("10 millis")),
  });

const renderCounting = <A,>(
  read: (r: ReturnType<typeof useQuery<A, never, never>>) => React.ReactNode,
  q: Query.QueryAtom<A, never, never>,
  options?: UseQueryOptions<A, never>,
) => {
  const { client } = setup();
  const renders = { count: 0 };
  function View() {
    renders.count++;
    const r = useQuery(q, options);
    return <p>{read(r)}</p>;
  }
  render(<View />, { wrapper: wrapper(client) });
  return { client, renders };
};

describe("tracked result properties", () => {
  it("does not re-render for changes to properties the component does not read", async () => {
    const q = stableQuery("tracked-data");
    const { client, renders } = renderCounting(
      (r) => (r.isSuccess ? r.data.value.title : "loading"),
      q,
    );
    expect(await screen.findByText("same")).toBeTruthy();
    const settled = renders.count;

    // A refetch flips isFetching / fetchStatus / dataUpdatedAt, but data is
    // structurally shared and status stays "success".
    await act(() => Effect.runPromise(client.refetchQueries({ queryKey: ["tracked-data"] })));
    expect(renders.count).toBe(settled);
  });

  it("re-renders when a read property changes", async () => {
    const q = stableQuery("tracked-fetching");
    const { client, renders } = renderCounting(
      (r) => `${r.isSuccess ? r.data.value.title : "loading"}:${r.isFetching}`,
      q,
    );
    expect(await screen.findByText("same:false")).toBeTruthy();
    const settled = renders.count;
    await act(() => Effect.runPromise(client.refetchQueries({ queryKey: ["tracked-fetching"] })));
    expect(screen.getByText("same:false")).toBeTruthy();
    // fetching: true, then false
    expect(renders.count).toBe(settled + 2);
  });

  it('re-renders on every change with notifyOnChangeProps: "all"', async () => {
    const q = stableQuery("tracked-all");
    const { client, renders } = renderCounting(
      (r) => (r.isSuccess ? r.data.value.title : "loading"),
      q,
      { notifyOnChangeProps: "all" },
    );
    expect(await screen.findByText("same")).toBeTruthy();
    const settled = renders.count;
    await act(() => Effect.runPromise(client.refetchQueries({ queryKey: ["tracked-all"] })));
    expect(renders.count).toBeGreaterThan(settled);
  });

  it("honours an explicit notifyOnChangeProps list", async () => {
    const q = stableQuery("tracked-list");
    const { client, renders } = renderCounting(
      (r) => (r.isSuccess ? r.data.value.title : "loading"),
      q,
      { notifyOnChangeProps: ["data", "isFetching"] },
    );
    expect(await screen.findByText("same")).toBeTruthy();
    const settled = renders.count;
    await act(() => Effect.runPromise(client.refetchQueries({ queryKey: ["tracked-list"] })));
    expect(renders.count).toBe(settled + 2);
  });

  it("tracks every property when the result is spread", async () => {
    const q = stableQuery("tracked-spread");
    const { client, renders } = renderCounting((r) => {
      const copy = { ...r };
      return copy.isSuccess ? copy.data.value.title : "loading";
    }, q);
    expect(await screen.findByText("same")).toBeTruthy();
    const settled = renders.count;
    await act(() => Effect.runPromise(client.refetchQueries({ queryKey: ["tracked-spread"] })));
    expect(renders.count).toBeGreaterThan(settled);
  });

  it("re-renders when data changes", async () => {
    let n = 0;
    const q = Query.single({
      key: ["tracked-changing"],
      run: Effect.sync(() => ++n).pipe(Effect.delay("5 millis")),
    });
    const { client } = renderCounting((r) => (r.isSuccess ? `n=${r.data.value}` : "loading"), q);
    expect(await screen.findByText("n=1")).toBeTruthy();
    await act(() => Effect.runPromise(client.refetchQueries({ queryKey: ["tracked-changing"] })));
    expect(await screen.findByText("n=2")).toBeTruthy();
  });

  it("tracks paging flags of infinite queries", async () => {
    const { client } = setup();
    const feed = InfiniteQuery.make({
      key: () => ["tracked-feed"],
      run: (_: void, page: number) => Effect.succeed(page).pipe(Effect.delay("5 millis")),
      initialPageParam: 0,
      getNextPageParam: (last) => (last < 1 ? Option.some(last + 1) : Option.none()),
    })();
    function Feed() {
      const r = useInfiniteQuery(feed);
      return (
        <div>
          <p>{r.isSuccess ? r.data.value.pages.join(",") : "loading"}</p>
          <p>{r.isFetchingNextPage ? "more…" : r.hasNextPage ? "has more" : "end"}</p>
          <button onClick={r.fetchNextPage}>next</button>
        </div>
      );
    }
    render(<Feed />, { wrapper: wrapper(client) });
    expect(await screen.findByText("has more")).toBeTruthy();
    act(() => screen.getByText("next").click());
    expect(await screen.findByText("more…")).toBeTruthy();
    await waitFor(() => expect(screen.getByText("0,1")).toBeTruthy());
    act(() => screen.getByText("next").click());
    expect(await screen.findByText("end")).toBeTruthy();
  });
});
