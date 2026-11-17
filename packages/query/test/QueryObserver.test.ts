import { assert, describe, it } from "@effect/vitest";
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
    assert.deepStrictEqual(shared, next);
    assert.notStrictEqual(shared, prev);
    assert.strictEqual(shared.a, prev.a);
    assert.strictEqual(shared.b[0], prev.b[0]);
    assert.notStrictEqual(shared.b[1], prev.b[1]);
    assert.strictEqual(replaceEqualDeep(prev, structuredClone(prev)), prev);
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
      assert.notStrictEqual(second, first);
      assert.strictEqual(second.stable, first.stable);
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
      assert.notStrictEqual(Option.getOrThrow(yield* client.getQueryData(q)), first);
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
      assert.strictEqual(r.data.value, 0);
      yield* settle;
      assert.strictEqual(runs.count, 0);
      registry.mount(stale);
      yield* settle;
      assert.strictEqual(runs.count, 1);
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
      assert.strictEqual(runs.count, 1);
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
      assert.deepInclude(observer.getCurrentResult(), {
        status: "pending",
        fetchStatus: "fetching",
      });
      assert.strictEqual(yield* client.isFetching(), 0); // optimistic only

      const unsubscribe = observer.subscribe(() => {});
      assert.strictEqual(yield* client.isFetching(), 1);
      yield* TestClock.adjust("1 second");
      yield* settle;
      assert.deepInclude(observer.getCurrentResult(), {
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
      assert.deepStrictEqual(a.data.value, [2, 3]);
      assert.strictEqual(b, a);
      assert.strictEqual(selects, 1);
      assert.deepStrictEqual(yield* client.getQueryData(q), Option.some({ items: [1, 2, 3] }));
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
      assert.isTrue(r.isPlaceholderData);
      assert.strictEqual(r.data.value, "page 1");
      yield* TestClock.adjust("1 second");
      yield* settle;
      assert.deepInclude(observer.getCurrentResult(), { isPlaceholderData: false });
      assert.deepStrictEqual(observer.getCurrentResult().data, Option.some("page 2"));
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
      assert.strictEqual(runs.count, 0);
      assert.deepInclude(observer.getCurrentResult(), { isEnabled: false, fetchStatus: "idle" });
      observer.setOptions(q, { enabled: true });
      yield* settle;
      assert.strictEqual(runs.count, 1);
    }),
  );

  it.effect("entries built but never observed are garbage collected", () =>
    Effect.gen(function* () {
      const { client } = yield* setup();
      const q = Query.single({ key: ["ghost"], run: Effect.succeed(1) });
      QueryObserver.make(client, q).getCurrentResult(); // e.g. a render that never committed
      assert.isTrue(Option.isSome(yield* client.getQueryState(q)));
      yield* TestClock.adjust("5 minutes");
      yield* settle;
      assert.deepStrictEqual(yield* client.getQueryState(q), Option.none());
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
      assert.deepInclude(first, { status: "pending", isEnabled: false, fetchStatus: "idle" });
      assert.strictEqual(observer.getCurrentResult(), first); // memoised
      let notified = 0;
      observer.subscribe(() => notified++);
      observer.refetch();
      observer.fetchPage("forward");
      assert.isUndefined(observer.fetchOptimistic(todo(Query.skipToken)));
      assert.isUndefined(observer.entryOf(todo(Query.skipToken)));
      yield* settle;
      assert.strictEqual(runs.count, 0);
      assert.strictEqual(yield* client.isFetching(), 0);

      observer.setOptions(todo(1));
      yield* settle;
      assert.strictEqual(runs.count, 1);
      assert.isAbove(notified, 0);
      assert.deepStrictEqual(observer.getCurrentResult().data, Option.some(1));
    }),
  );

  it.effect("placeholderData applies to skipped queries too", () =>
    Effect.gen(function* () {
      const { client } = yield* setup();
      const todo = Query.make({ key: (id: number) => ["skip-ph", id], run: Effect.succeed });
      const observer = QueryObserver.make(client, todo(Query.skipToken), { placeholderData: 42 });
      const r = observer.getCurrentResult();
      assert(r.isSuccess);
      assert.isTrue(r.isPlaceholderData);
      assert.strictEqual(r.data.value, 42);
      assert.isFalse(r.isEnabled);
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
      assert.strictEqual(yield* Fiber.join(fiber), 1);
      assert.strictEqual(yield* Fiber.join(joined), 1);
      assert.strictEqual(runs.count, 1);
      // fresh data: nothing to wait for
      assert.isUndefined(observer.fetchOptimistic(q));
    }),
  );

  it.effect("entryOf finds the cache entry of a query", () =>
    Effect.gen(function* () {
      const { client } = yield* setup();
      const q = Query.single({ key: ["entry-of"], run: Effect.succeed("x") });
      const observer = QueryObserver.make(client, q);
      assert.isUndefined(observer.entryOf(q));
      observer.getCurrentResult(); // builds the entry
      const entry = observer.entryOf(q);
      assert(entry !== undefined);
      assert.deepStrictEqual(entry.key, ["entry-of"]);
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
      assert.strictEqual(runs.count, 1);
      const unsubscribe = observer.subscribe(() => {});
      yield* settle;
      assert.strictEqual(runs.count, 1); // fresh: no mount fetch
      observer.refetch();
      yield* settle;
      assert.strictEqual(runs.count, 2);
      assert.deepStrictEqual(observer.getCurrentResult().data, Option.some(2));
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
      assert.deepStrictEqual(pages(), [0, 1]);
      observer.subscribe(() => {});
      observer.fetchPage("forward");
      yield* settle;
      assert.deepStrictEqual(pages(), [0, 1, 2, 3]);
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
      assert.deepInclude(r, { isPlaceholderData: true, isRefetching: true, isLoading: false });
      assert.strictEqual(r.data.value, 0);

      const none = QueryObserver.make(client, q, { placeholderData: () => Option.none<number>() });
      assert.deepInclude(none.getCurrentResult(), {
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
      assert.deepStrictEqual(second.data.value, { tags: ["a", "b"], parity: 0 });
      assert.notStrictEqual(second.data.value, first.data.value);
      assert.strictEqual(second.data.value.tags, first.data.value.tags);
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
      assert.strictEqual(runs.count, 0);
      observer.subscribe(() => {});
      yield* settle;
      assert.strictEqual(runs.count, 0);
      assert.deepInclude(observer.getCurrentResult(), { isEnabled: false });
    }),
  );

  it.effect("a new atom with the same key updates in place, without refetching", () =>
    Effect.gen(function* () {
      const { client } = yield* setup();
      const runs = counter();
      const make = () => Query.single({ key: ["same-key"], run: runs.tick });
      const a = make();
      const b = make();
      assert.notStrictEqual(a, b);
      const observer = QueryObserver.make(client, a);
      let notified = 0;
      observer.subscribe(() => notified++);
      yield* settle;
      const before = notified;
      observer.setOptions(b);
      yield* settle;
      assert.strictEqual(runs.count, 1);
      assert.strictEqual(notified, before);
      assert.deepStrictEqual(observer.getCurrentResult().data, Option.some(1));
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
      assert.strictEqual(runs.count, 1);
      assert.deepInclude(observer.getCurrentResult(), { isEnabled: true, isStale: false });
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
      assert.isTrue(entry.isActive);
      a();
      assert.isTrue(entry.isActive);
      b();
      assert.isFalse(entry.isActive);
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
      assert.notStrictEqual(second, first);
      assert.isTrue(second.isActive);
      assert.strictEqual(runs.count, 2);
      assert.deepStrictEqual(observer.getCurrentResult().data, Option.some(2));
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
      assert.deepStrictEqual(
        observer.getOptimisticResults(inputs([1, 2])).map((r) => r.fetchStatus),
        ["fetching", "fetching"],
      );
      assert.deepStrictEqual(fetched, []);

      let versions = 0;
      const unsubscribe = observer.subscribe(() => versions++);
      yield* settle;
      assert.deepStrictEqual(fetched, [1, 2]);
      assert.deepStrictEqual(
        observer.getOptimisticResults(inputs([1, 2])).map((r) => r.data),
        [Option.some(10), Option.some(20)],
      );
      assert.strictEqual(observer.version, versions);

      // grow: the new observer is subscribed and fetches
      observer.setQueries(inputs([1, 2, 3]));
      yield* settle;
      assert.deepStrictEqual(fetched, [1, 2, 3]);
      assert.deepStrictEqual(
        client.cache.get(item(3).key).pipe(Option.map((e) => e.isActive)),
        Option.some(true),
      );

      // shrink: the dropped observer is unsubscribed
      observer.setQueries(inputs([1]));
      assert.deepStrictEqual(
        client.cache.get(item(3).key).pipe(Option.map((e) => e.isActive)),
        Option.some(false),
      );

      // same length, new key: re-attaches without changing the list
      const before = observer.version;
      observer.setQueries(inputs([4]));
      yield* settle;
      assert.deepStrictEqual(fetched, [1, 2, 3, 4]);
      assert.isAbove(observer.version, before);

      observer.refetch(0);
      observer.refetch(5); // out of range: ignored
      yield* settle;
      assert.deepStrictEqual(fetched, [1, 2, 3, 4, 4]);

      const v = observer.version;
      observer.notify();
      assert.strictEqual(observer.version, v + 1);

      unsubscribe();
      assert.deepStrictEqual(
        client.cache.get(item(4).key).pipe(Option.map((e) => e.isActive)),
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
      assert.strictEqual(runs.count, 0);
      assert.strictEqual(notified, 0);
      assert.strictEqual(observer.version, 1); // length changed
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
      assert.lengthOf(fibers, 1);
      assert.strictEqual(yield* Fiber.join(fibers[0]!), "s");
    }),
  );
});
