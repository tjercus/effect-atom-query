import { assert, describe, expect, it } from "@effect/vitest";
import { Effect, Option } from "effect";
import { TestClock } from "effect/testing";
import { Query, QueryObserver } from "../src/index.ts";
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
