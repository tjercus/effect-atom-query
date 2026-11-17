import { assert, describe, it } from "@effect/vitest";
import { Effect, Option } from "effect";
import { TestClock } from "effect/testing";
import { InfiniteQuery, Query, QueryObserver } from "../src/index.ts";
import { counter, settle, setup } from "./utils.ts";

/** Items 0..total-1, served in pages of `size`, cursor = first index. */
const makeFeed = (options?: { total?: number; maxPages?: number; offset?: () => number }) => {
  const total = options?.total ?? 10;
  const fetched: Array<number> = [];
  const feed = InfiniteQuery.make({
    key: (name: string) => ["feed", name],
    run: (_name, cursor: number) =>
      Effect.sync(() => {
        fetched.push(cursor);
        const shift = options?.offset?.() ?? 0;
        const items = Array.from({ length: 3 }, (_, i) => cursor + i + shift).filter(
          (n) => n < total,
        );
        return {
          items,
          next: cursor + 3 < total ? Option.some(cursor + 3) : Option.none<number>(),
        };
      }),
    initialPageParam: 0,
    getNextPageParam: (page) => page.next,
    getPreviousPageParam: (_page, _all, cursor) =>
      cursor > 0 ? Option.some(cursor - 3) : Option.none(),
    maxPages: options?.maxPages,
  });
  return { feed, fetched };
};

const items = (r: {
  readonly data: Option.Option<
    InfiniteQuery.InfiniteData<{ items: ReadonlyArray<number> }, number>
  >;
}) => Option.match(r.data, { onNone: () => [], onSome: (d) => d.pages.flatMap((p) => p.items) });

describe("InfiniteQuery", () => {
  it.effect("loads the first page, then more pages on demand", () =>
    Effect.gen(function* () {
      const { client, registry } = yield* setup();
      const { feed, fetched } = makeFeed();
      const q = feed("all");
      registry.mount(q);
      yield* settle;
      assert.deepStrictEqual(items(registry.get(q)), [0, 1, 2]);
      const entry = client.cache.get<any, any>(q.key);
      assert.deepInclude(InfiniteQuery.pagingState(q.infinite, Option.getOrUndefined(entry)), {
        hasNextPage: true,
        hasPreviousPage: false,
      });

      registry.set(q, "next");
      yield* settle;
      registry.set(q, "next");
      yield* settle;
      registry.set(q, "next");
      yield* settle;
      assert.deepStrictEqual(items(registry.get(q)), [0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
      assert.deepStrictEqual(fetched, [0, 3, 6, 9]);
      registry.set(q, "next"); // no next page: no fetch
      yield* settle;
      assert.deepStrictEqual(fetched, [0, 3, 6, 9]);
      const r = registry.get(q);
      assert(r.isSuccess);
      assert.deepStrictEqual(r.data.value.pageParams, [0, 3, 6, 9]);
    }),
  );

  it.effect("refetches every loaded page in order, following fresh page params", () =>
    Effect.gen(function* () {
      let shift = 0;
      const { registry } = yield* setup();
      const { feed, fetched } = makeFeed({ total: 1000, offset: () => shift });
      const q = feed("refetch");
      registry.mount(q);
      yield* settle;
      registry.set(q, "next");
      yield* settle;
      fetched.length = 0;
      shift = 100;
      registry.refresh(q);
      yield* settle;
      assert.deepStrictEqual(fetched, [0, 3]);
      assert.deepStrictEqual(items(registry.get(q)), [100, 101, 102, 103, 104, 105]);
    }),
  );

  it.effect("keeps at most maxPages and can page backwards", () =>
    Effect.gen(function* () {
      const { registry } = yield* setup();
      const { feed } = makeFeed({ maxPages: 2 });
      const q = feed("window");
      registry.mount(q);
      yield* settle;
      registry.set(q, "next");
      yield* settle;
      registry.set(q, "next");
      yield* settle;
      assert.deepStrictEqual(items(registry.get(q)), [3, 4, 5, 6, 7, 8]);
      registry.set(q, "previous");
      yield* settle;
      assert.deepStrictEqual(items(registry.get(q)), [0, 1, 2, 3, 4, 5]);
    }),
  );

  it.effect("works with fetchQuery and invalidation", () =>
    Effect.gen(function* () {
      const { client, registry } = yield* setup();
      const { feed, fetched } = makeFeed();
      const q = feed("client");
      const data = yield* client.fetchQuery(q);
      assert.lengthOf(data.pages, 1);
      registry.mount(q);
      registry.set(q, "next");
      yield* settle;
      fetched.length = 0;
      yield* client.invalidateQueries({ queryKey: ["feed"] });
      assert.deepStrictEqual(fetched, [0, 3]);
    }),
  );

  it.effect("tracks the direction of a running fetch", () =>
    Effect.gen(function* () {
      const { client, registry } = yield* setup();
      const slow = InfiniteQuery.make({
        key: () => ["slow-feed"],
        run: (_: void, cursor: number) => Effect.succeed(cursor).pipe(Effect.delay("1 second")),
        initialPageParam: 0,
        getNextPageParam: (last) => Option.some(last + 1),
      });
      const q = slow();
      registry.mount(q);
      yield* TestClock.adjust("1 second");
      yield* settle;
      registry.set(q, "next");
      yield* settle;
      const entry = Option.getOrUndefined(client.cache.get<any, any>(q.key));
      assert.deepInclude(InfiniteQuery.pagingState(q.infinite, entry), {
        isFetchingNextPage: true,
      });
      yield* TestClock.adjust("1 second");
      yield* settle;
      assert.deepInclude(InfiniteQuery.pagingState(q.infinite, entry), {
        isFetchingNextPage: false,
      });
    }),
  );
});

describe("observer staleTime", () => {
  it.effect("overrides the definition's staleTime for mount refetches and isStale", () =>
    Effect.gen(function* () {
      const { client, registry } = yield* setup();
      const runs = counter();
      const q = Query.single({ key: ["observer-stale"], run: runs.tick });
      registry.mount(q);
      yield* settle;
      const observer = QueryObserver.make(client, q, { staleTime: "1 minute" });
      assert.isFalse(observer.getCurrentResult().isStale);
      observer.subscribe(() => {});
      yield* settle;
      assert.strictEqual(runs.count, 1);
    }),
  );
});
