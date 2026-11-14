import { assert, describe, expect, it } from "@effect/vitest";
import { Effect, Fiber, Option } from "effect";
import { TestClock } from "effect/testing";
import { InfiniteQuery, Query, QueryObserver } from "../src/index.ts";
import { replaceEqualDeep } from "../src/internal/structuralSharing.ts";
import { counter, settle, setup } from "./utils.ts";

describe("structural sharing", () => {
  it("replaceEqualDeep reuses unchanged subtrees", () => {
    const prev = { a: { x: 1 }, b: [{ y: 1 }, { y: 2 }], c: 1 };
    const next = { a: { x: 1 }, b: [{ y: 1 }, { y: 3 }], c: 1 };
    const shared = replaceEqualDeep(prev, next);
    expect(shared).toEqual(next);
    expect(shared).not.toBe(prev);
    expect(shared.a).toBe(prev.a);
    expect(shared.b[0]).toBe(prev.b[0]);
    expect(shared.b[1]).not.toBe(prev.b[1]);
    expect(replaceEqualDeep(prev, structuredClone(prev))).toBe(prev);
  });

  it.effect("refetching equal data keeps the previous reference", () =>
    Effect.gen(function* () {
      const { client, registry } = yield* setup();
      let n = 0;
      const q = Query.single({
        key: ["shared"],
        run: Effect.sync(() => ({ stable: { deep: [1, 2] }, n: ++n })),
      });
      registry.mount(q);
      yield* settle;
      const first = Option.getOrThrow(yield* client.getQueryData(q));
      registry.refresh(q);
      yield* settle;
      const second = Option.getOrThrow(yield* client.getQueryData(q));
      expect(second).not.toBe(first);
      expect(second.stable).toBe(first.stable);
    }),
  );

  it.effect("can be disabled", () =>
    Effect.gen(function* () {
      const { client, registry } = yield* setup();
      const q = Query.single({
        key: ["unshared"],
        run: Effect.sync(() => ({ a: 1 })),
        structuralSharing: false,
      });
      registry.mount(q);
      yield* settle;
      const first = Option.getOrThrow(yield* client.getQueryData(q));
      registry.refresh(q);
      yield* settle;
      expect(Option.getOrThrow(yield* client.getQueryData(q))).not.toBe(first);
    }),
  );
});

describe("initialData", () => {
  it.effect("seeds the cache and is stale unless staleTime covers it", () =>
    Effect.gen(function* () {
      const { registry } = yield* setup();
      const runs = counter();
      const fresh = Query.single({
        key: ["i1"],
        run: runs.tick,
        initialData: () => 0,
        staleTime: "1 minute",
      });
      const stale = Query.single({ key: ["i2"], run: runs.tick, initialData: () => 0 });
      registry.mount(fresh);
      const r = registry.get(fresh);
      assert(r.isSuccess);
      expect(r.data.value).toBe(0);
      yield* settle;
      expect(runs.count).toBe(0);
      registry.mount(stale);
      yield* settle;
      expect(runs.count).toBe(1);
    }),
  );

  it.effect("initialDataUpdatedAt decides freshness", () =>
    Effect.gen(function* () {
      yield* TestClock.adjust("10 minutes");
      const { registry } = yield* setup();
      const runs = counter();
      const now = 10 * 60 * 1000;
      const q = Query.make({
        key: (id: number) => ["i3", id],
        run: () => runs.tick,
        initialData: () => 0,
        initialDataUpdatedAt: (id) => now - id * 60_000,
        staleTime: "2 minutes",
      });
      registry.mount(q(1)); // 1 minute old: fresh
      registry.mount(q(5)); // 5 minutes old: stale
      yield* settle;
      expect(runs.count).toBe(1);
    }),
  );
});

describe("QueryObserver", () => {
  it.effect("computes an optimistic result before mounting and fetches once attached", () =>
    Effect.gen(function* () {
      const { client } = yield* setup();
      const q = Query.single({
        key: ["obs"],
        run: Effect.succeed(1).pipe(Effect.delay("1 second")),
      });
      const observer = QueryObserver.make(client, q);
      expect(observer.getCurrentResult()).toMatchObject({
        status: "pending",
        fetchStatus: "fetching",
      });
      expect(yield* client.isFetching()).toBe(0); // optimistic only

      const unsubscribe = observer.subscribe(() => {});
      expect(yield* client.isFetching()).toBe(1);
      yield* TestClock.adjust("1 second");
      yield* settle;
      expect(observer.getCurrentResult()).toMatchObject({
        status: "success",
        isFetchedAfterMount: true,
      });
      unsubscribe();
    }),
  );

  it.effect("select is memoised per input and does not touch the cache", () =>
    Effect.gen(function* () {
      const { client } = yield* setup();
      let selects = 0;
      const q = Query.single({ key: ["sel"], run: Effect.succeed({ items: [1, 2, 3] }) });
      const select = (d: { readonly items: ReadonlyArray<number> }) => {
        selects++;
        return d.items.filter((n) => n > 1);
      };
      const observer = QueryObserver.make(client, q, { select });
      observer.subscribe(() => {});
      yield* settle;
      const a = observer.getCurrentResult();
      const b = observer.getCurrentResult();
      assert(a.isSuccess);
      expect(a.data.value).toEqual([2, 3]);
      expect(b).toBe(a);
      expect(selects).toBe(1);
      expect(yield* client.getQueryData(q)).toEqual(Option.some({ items: [1, 2, 3] }));
    }),
  );

  it.effect("keepPreviousData shows the previous key's data while the next loads", () =>
    Effect.gen(function* () {
      const { client } = yield* setup();
      const page = Query.make({
        key: (n: number) => ["page", n],
        run: (n) => Effect.succeed(`page ${n}`).pipe(Effect.delay("1 second")),
      });
      const options = { placeholderData: Query.keepPreviousData };
      const observer = QueryObserver.make(client, page(1), options);
      observer.subscribe(() => {});
      yield* TestClock.adjust("1 second");
      yield* settle;
      observer.setOptions(page(2), options);
      const r = observer.getCurrentResult();
      assert(r.isSuccess);
      expect(r.isPlaceholderData).toBe(true);
      expect(r.data.value).toBe("page 1");
      yield* TestClock.adjust("1 second");
      yield* settle;
      expect(observer.getCurrentResult()).toMatchObject({ isPlaceholderData: false });
      expect(observer.getCurrentResult().data).toEqual(Option.some("page 2"));
    }),
  );

  it.effect("disabled observers do not fetch, enabling them does", () =>
    Effect.gen(function* () {
      const { client } = yield* setup();
      const runs = counter();
      const q = Query.single({ key: ["toggle"], run: runs.tick });
      const observer = QueryObserver.make(client, q, { enabled: false });
      observer.subscribe(() => {});
      yield* settle;
      expect(runs.count).toBe(0);
      expect(observer.getCurrentResult()).toMatchObject({ isEnabled: false, fetchStatus: "idle" });
      observer.setOptions(q, { enabled: true });
      yield* settle;
      expect(runs.count).toBe(1);
    }),
  );

  it.effect("entries built but never observed are garbage collected", () =>
    Effect.gen(function* () {
      const { client } = yield* setup();
      const q = Query.single({ key: ["ghost"], run: Effect.succeed(1) });
      QueryObserver.make(client, q).getCurrentResult(); // e.g. a render that never committed
      expect(Option.isSome(yield* client.getQueryState(q))).toBe(true);
      yield* TestClock.adjust("5 minutes");
      yield* settle;
      expect(yield* client.getQueryState(q)).toEqual(Option.none());
    }),
  );
});

describe("QueryObserver with skipToken", () => {
  it.effect("is disabled, never fetches, and attaches once a real query arrives", () =>
    Effect.gen(function* () {
      const { client } = yield* setup();
      const runs = counter();
      const todo = Query.make({ key: (id: number) => ["skip-todo", id], run: () => runs.tick });
      const observer = QueryObserver.make(client, todo(Query.skipToken));
      const first = observer.getCurrentResult();
      expect(first).toMatchObject({ status: "pending", isEnabled: false, fetchStatus: "idle" });
      expect(observer.getCurrentResult()).toBe(first); // memoised
      let notified = 0;
      observer.subscribe(() => notified++);
      observer.refetch();
      observer.fetchPage("forward");
      expect(observer.fetchOptimistic(todo(Query.skipToken))).toBeUndefined();
      expect(observer.entryOf(todo(Query.skipToken))).toBeUndefined();
      yield* settle;
      expect(runs.count).toBe(0);
      expect(yield* client.isFetching()).toBe(0);

      observer.setOptions(todo(1));
      yield* settle;
      expect(runs.count).toBe(1);
      expect(notified).toBeGreaterThan(0);
      expect(observer.getCurrentResult().data).toEqual(Option.some(1));
    }),
  );

  it.effect("placeholderData applies to skipped queries too", () =>
    Effect.gen(function* () {
      const { client } = yield* setup();
      const todo = Query.make({ key: (id: number) => ["skip-ph", id], run: Effect.succeed });
      const observer = QueryObserver.make(client, todo(Query.skipToken), { placeholderData: 42 });
      const r = observer.getCurrentResult();
      assert(r.isSuccess);
      expect(r.isPlaceholderData).toBe(true);
      expect(r.data.value).toBe(42);
      expect(r.isEnabled).toBe(false);
    }),
  );
});

describe("QueryObserver imperative API", () => {
  it.effect("fetchOptimistic starts, joins, or skips the mount fetch", () =>
    Effect.gen(function* () {
      const { client } = yield* setup();
      const runs = counter();
      const q = Query.single({
        key: ["optimistic"],
        run: runs.tick.pipe(Effect.delay("1 second")),
        staleTime: "1 minute",
      });
      const observer = QueryObserver.make(client, q);
      const fiber = observer.fetchOptimistic(q);
      assert(fiber !== undefined);
      const joined = observer.fetchOptimistic(q); // already fetching: join
      assert(joined !== undefined);
      yield* TestClock.adjust("1 second");
      expect(yield* Fiber.join(fiber)).toBe(1);
      expect(yield* Fiber.join(joined)).toBe(1);
      expect(runs.count).toBe(1);
      // fresh data: nothing to wait for
      expect(observer.fetchOptimistic(q)).toBeUndefined();
    }),
  );

  it.effect("entryOf finds the cache entry of a query", () =>
    Effect.gen(function* () {
      const { client } = yield* setup();
      const q = Query.single({ key: ["entry-of"], run: Effect.succeed("x") });
      const observer = QueryObserver.make(client, q);
      expect(observer.entryOf(q)).toBeUndefined();
      observer.getCurrentResult(); // builds the entry
      const entry = observer.entryOf(q);
      assert(entry !== undefined);
      expect(entry.key).toEqual(["entry-of"]);
    }),
  );

  it.effect("refetch forces a fetch of fresh data, mounted or not", () =>
    Effect.gen(function* () {
      const { client } = yield* setup();
      const runs = counter();
      const q = Query.single({ key: ["obs-refetch"], run: runs.tick, staleTime: "1 hour" });
      const observer = QueryObserver.make(client, q);
      observer.refetch(); // not subscribed: builds the entry and fetches
      yield* settle;
      expect(runs.count).toBe(1);
      const unsubscribe = observer.subscribe(() => {});
      yield* settle;
      expect(runs.count).toBe(1); // fresh: no mount fetch
      observer.refetch();
      yield* settle;
      expect(runs.count).toBe(2);
      expect(observer.getCurrentResult().data).toEqual(Option.some(2));
      unsubscribe();
    }),
  );

  it.effect("fetchPage loads more pages of an infinite query, mounted or not", () =>
    Effect.gen(function* () {
      const { client } = yield* setup();
      const feed = InfiniteQuery.infiniteQueryOptions({
        key: ["obs-feed"],
        run: (cursor: number) => Effect.succeed([cursor, cursor + 1]),
        initialPageParam: 0,
        getNextPageParam: (_page, _all, cursor) => Option.some(cursor + 2),
        staleTime: "1 hour",
      });
      const observer = QueryObserver.make(client, feed);
      const pages = () =>
        Option.map(observer.getCurrentResult().data, (d) => d.pages.flat()).pipe(
          Option.getOrElse(() => []),
        );
      observer.fetchPage("forward"); // unmounted: builds the entry
      yield* settle;
      expect(pages()).toEqual([0, 1]);
      observer.subscribe(() => {});
      observer.fetchPage("forward");
      yield* settle;
      expect(pages()).toEqual([0, 1, 2, 3]);
    }),
  );
});

describe("QueryObserver options", () => {
  it.effect("placeholderData can be a value, or a function returning None", () =>
    Effect.gen(function* () {
      const { client } = yield* setup();
      const q = Query.single({
        key: ["ph-value"],
        run: Effect.succeed(1).pipe(Effect.delay("1 second")),
      });
      const value = QueryObserver.make(client, q, { placeholderData: 0 });
      const r = value.getCurrentResult();
      assert(r.isSuccess);
      expect(r).toMatchObject({ isPlaceholderData: true, isRefetching: true, isLoading: false });
      expect(r.data.value).toBe(0);

      const none = QueryObserver.make(client, q, { placeholderData: () => Option.none<number>() });
      expect(none.getCurrentResult()).toMatchObject({
        status: "pending",
        isPlaceholderData: false,
      });
    }),
  );

  it.effect("select re-runs on new data and shares structure with its previous output", () =>
    Effect.gen(function* () {
      const { client } = yield* setup();
      let n = 0;
      const q = Query.single({
        key: ["sel-share"],
        run: Effect.sync(() => ({ n: ++n, tags: ["a", "b"] })),
        structuralSharing: false,
      });
      const select = (d: { readonly n: number; readonly tags: ReadonlyArray<string> }) => ({
        tags: [...d.tags],
        parity: d.n % 2,
      });
      const observer = QueryObserver.make(client, q, { select });
      observer.subscribe(() => {});
      yield* settle;
      const first = observer.getCurrentResult();
      assert(first.isSuccess);
      observer.refetch();
      yield* settle;
      const second = observer.getCurrentResult();
      assert(second.isSuccess);
      expect(second.data.value).toEqual({ tags: ["a", "b"], parity: 0 });
      expect(second.data.value).not.toBe(first.data.value);
      expect(second.data.value.tags).toBe(first.data.value.tags);
    }),
  );

  it.effect("setOptions before subscribing only stores the options", () =>
    Effect.gen(function* () {
      const { client } = yield* setup();
      const runs = counter();
      const q = Query.single({ key: ["late-opts"], run: runs.tick });
      const observer = QueryObserver.make(client, q);
      observer.setOptions(q, { enabled: false });
      yield* settle;
      expect(runs.count).toBe(0);
      observer.subscribe(() => {});
      yield* settle;
      expect(runs.count).toBe(0);
      expect(observer.getCurrentResult()).toMatchObject({ isEnabled: false });
    }),
  );

  it.effect("a new atom with the same key updates in place, without refetching", () =>
    Effect.gen(function* () {
      const { client } = yield* setup();
      const runs = counter();
      const make = () => Query.single({ key: ["same-key"], run: runs.tick });
      const a = make();
      const b = make();
      expect(a).not.toBe(b);
      const observer = QueryObserver.make(client, a);
      let notified = 0;
      observer.subscribe(() => notified++);
      yield* settle;
      const before = notified;
      observer.setOptions(b);
      yield* settle;
      expect(runs.count).toBe(1);
      expect(notified).toBe(before);
      expect(observer.getCurrentResult().data).toEqual(Option.some(1));
    }),
  );

  it.effect("enabling an observer with fresh data does not fetch", () =>
    Effect.gen(function* () {
      const { client } = yield* setup();
      const runs = counter();
      const q = Query.single({ key: ["enable-fresh"], run: runs.tick, staleTime: "1 hour" });
      yield* client.fetchQuery(q);
      const observer = QueryObserver.make(client, q, { enabled: false });
      observer.subscribe(() => {});
      observer.setOptions(q, { enabled: true });
      yield* settle;
      expect(runs.count).toBe(1);
      expect(observer.getCurrentResult()).toMatchObject({ isEnabled: true, isStale: false });
    }),
  );
});

describe("QueryObserver lifecycle", () => {
  it.effect("shares one attachment across listeners and detaches after the last", () =>
    Effect.gen(function* () {
      const { client } = yield* setup();
      const q = Query.single({ key: ["two-listeners"], run: Effect.succeed(1) });
      const observer = QueryObserver.make(client, q);
      const a = observer.subscribe(() => {});
      const b = observer.subscribe(() => {});
      yield* settle;
      const entry = observer.entryOf(q);
      assert(entry !== undefined);
      expect(entry.isActive).toBe(true);
      a();
      expect(entry.isActive).toBe(true);
      b();
      expect(entry.isActive).toBe(false);
    }),
  );

  it.effect("re-attaches to a fresh entry and refetches when removed while observed", () =>
    Effect.gen(function* () {
      const { client } = yield* setup();
      const runs = counter();
      const q = Query.single({ key: ["removed"], run: runs.tick });
      const observer = QueryObserver.make(client, q);
      observer.subscribe(() => {});
      yield* settle;
      const first = observer.entryOf(q);
      yield* client.removeQueries({ queryKey: ["removed"] });
      yield* settle;
      const second = observer.entryOf(q);
      assert(second !== undefined);
      expect(second).not.toBe(first);
      expect(second.isActive).toBe(true);
      expect(runs.count).toBe(2);
      expect(observer.getCurrentResult().data).toEqual(Option.some(2));
    }),
  );
});

describe("QueriesObserver", () => {
  it.effect("observes a list of queries that can grow and shrink", () =>
    Effect.gen(function* () {
      const { client } = yield* setup();
      const fetched: Array<number> = [];
      const item = Query.make({
        key: (id: number) => ["item", id],
        run: (id) => Effect.sync(() => (fetched.push(id), id * 10)),
      });
      const inputs = (ids: ReadonlyArray<number>) => ids.map((id) => ({ query: item(id) }));
      const observer = new QueryObserver.QueriesObserver(client, inputs([1, 2]));
      expect(observer.getOptimisticResults(inputs([1, 2])).map((r) => r.fetchStatus)).toEqual([
        "fetching",
        "fetching",
      ]);
      expect(fetched).toEqual([]);

      let versions = 0;
      const unsubscribe = observer.subscribe(() => versions++);
      yield* settle;
      expect(fetched).toEqual([1, 2]);
      expect(observer.getOptimisticResults(inputs([1, 2])).map((r) => r.data)).toEqual([
        Option.some(10),
        Option.some(20),
      ]);
      expect(observer.version).toBe(versions);

      // grow: the new observer is subscribed and fetches
      observer.setQueries(inputs([1, 2, 3]));
      yield* settle;
      expect(fetched).toEqual([1, 2, 3]);
      expect(client.cache.get(item(3).key).pipe(Option.map((e) => e.isActive))).toEqual(
        Option.some(true),
      );

      // shrink: the dropped observer is unsubscribed
      observer.setQueries(inputs([1]));
      expect(client.cache.get(item(3).key).pipe(Option.map((e) => e.isActive))).toEqual(
        Option.some(false),
      );

      // same length, new key: re-attaches without changing the list
      const before = observer.version;
      observer.setQueries(inputs([4]));
      yield* settle;
      expect(fetched).toEqual([1, 2, 3, 4]);
      expect(observer.version).toBeGreaterThan(before);

      observer.refetch(0);
      observer.refetch(5); // out of range: ignored
      yield* settle;
      expect(fetched).toEqual([1, 2, 3, 4, 4]);

      const v = observer.version;
      observer.notify();
      expect(observer.version).toBe(v + 1);

      unsubscribe();
      expect(client.cache.get(item(4).key).pipe(Option.map((e) => e.isActive))).toEqual(
        Option.some(false),
      );
    }),
  );

  it.effect("setQueries while unsubscribed does not attach", () =>
    Effect.gen(function* () {
      const { client } = yield* setup();
      const runs = counter();
      const q = Query.make({ key: (id: number) => ["lazy", id], run: () => runs.tick });
      const observer = new QueryObserver.QueriesObserver(client, []);
      let notified = 0;
      observer.subscribe(() => notified++)();
      observer.setQueries([{ query: q(1) }, { query: q(2) }]);
      yield* settle;
      expect(runs.count).toBe(0);
      expect(notified).toBe(0);
      expect(observer.version).toBe(1); // length changed
    }),
  );

  it.effect("fetchOptimistic returns fibers only for fetches mounting would start", () =>
    Effect.gen(function* () {
      const { client } = yield* setup();
      const fresh = Query.single({
        key: ["qs-fresh"],
        run: Effect.succeed("f"),
        staleTime: "1 hour",
      });
      const stale = Query.single({ key: ["qs-stale"], run: Effect.succeed("s") });
      yield* client.fetchQuery(fresh);
      const inputs = [
        { query: fresh },
        { query: stale },
        {
          query: Query.make({ key: (n: number) => ["qs-skip", n], run: Effect.succeed })(
            Query.skipToken,
          ),
        },
      ];
      const observer = new QueryObserver.QueriesObserver(client, []);
      const fibers = observer.fetchOptimistic(inputs);
      expect(fibers).toHaveLength(1);
      expect(yield* Fiber.join(fibers[0]!)).toBe("s");
    }),
  );
});
