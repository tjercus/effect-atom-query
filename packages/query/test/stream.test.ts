import { assert, describe, it } from "@effect/vitest";
import { Cause, Context, Effect, Exit, Fiber, Option, Queue, Stream } from "effect";
import { TestClock } from "effect/testing";
import { expectTypeOf } from "vite-plus/test";
import { Query, type QueryClient, QueryObserver, QueryResult } from "../src/index.ts";
import { counter, settle, setup } from "./utils.ts";

interface Item {
  readonly id: number;
  readonly text: string;
}

const item = (id: number, text = `item ${id}`): Item => ({ id, text });

/** Idempotent: replaces the item with the same id, or adds it. */
const upsert = (items: ReadonlyArray<Item>, next: Item): ReadonlyArray<Item> =>
  items.some((i) => i.id === next.id)
    ? items.map((i) => (i.id === next.id ? next : i))
    : [...items, next];

/**
 * A fake connection, driven by the test. Each run of `updates` is a new
 * connection; `emit`, `fail` and `end` act on the latest one.
 */
const makeSource = <U>() => {
  let queue: Queue.Queue<U, string | Cause.Done> | undefined;
  const state = { opened: 0, closed: 0 };
  const latest = Effect.suspend(() =>
    queue === undefined ? Effect.die(new Error("not connected")) : Effect.succeed(queue),
  );
  return {
    state,
    updates: Stream.unwrap(
      Effect.gen(function* () {
        const q = yield* Queue.unbounded<U, string | Cause.Done>();
        queue = q;
        state.opened++;
        return Stream.fromQueue(q).pipe(Stream.ensuring(Effect.sync(() => state.closed++)));
      }),
    ),
    emit: (update: U) =>
      Effect.andThen(
        Effect.flatMap(latest, (q) => Queue.offer(q, update)),
        settle,
      ),
    fail: (error: string) =>
      Effect.andThen(
        Effect.flatMap(latest, (q) => Queue.fail(q, error)),
        settle,
      ),
    end: Effect.andThen(Effect.flatMap(latest, Queue.end), settle),
  };
};

describe("stream: applying updates", () => {
  it.effect("applies updates to the data while the query is observed", () =>
    Effect.gen(function* () {
      const { registry } = yield* setup();
      const source = makeSource<Item>();
      const q = Query.single({
        key: ["live"],
        run: Effect.succeed<ReadonlyArray<Item>>([item(1)]),
        stream: { updates: source.updates, apply: upsert },
        staleTime: "Infinity",
      });
      registry.mount(q);
      yield* settle;
      assert.strictEqual(registry.get(q).streamStatus, "open");
      assert.strictEqual(source.state.opened, 1);

      yield* source.emit(item(2));
      yield* source.emit(item(1, "changed"));
      const result = registry.get(q);
      assert.deepStrictEqual(Option.getOrThrow(result.data), [item(1, "changed"), item(2)]);
      assert.strictEqual(result.dataUpdateCount, 3);
      assert.isFalse(result.isStale);
    }),
  );

  it.effect("does not notify for an update that changes nothing", () =>
    Effect.gen(function* () {
      const { registry } = yield* setup();
      const source = makeSource<Item>();
      const q = Query.single({
        key: ["live-same"],
        run: Effect.succeed<ReadonlyArray<Item>>([item(1)]),
        stream: { updates: source.updates, apply: upsert },
      });
      registry.mount(q);
      yield* settle;
      const before = registry.get(q);
      yield* source.emit(item(1));
      assert.strictEqual(registry.get(q), before);
    }),
  );

  it.effect("applies updates that arrived before the first data", () =>
    Effect.gen(function* () {
      const { registry } = yield* setup();
      const source = makeSource<Item>();
      const q = Query.single({
        key: ["live-early"],
        run: Effect.succeed<ReadonlyArray<Item>>([item(1)]).pipe(Effect.delay("1 second")),
        stream: { updates: source.updates, apply: upsert },
      });
      registry.mount(q);
      yield* settle;
      yield* source.emit(item(2));
      assert.isTrue(registry.get(q).isPending);

      yield* TestClock.adjust("1 second");
      yield* settle;
      assert.deepStrictEqual(Option.getOrThrow(registry.get(q).data), [item(1), item(2)]);
    }),
  );

  it.effect("applies updates received during a refetch again to its result", () =>
    Effect.gen(function* () {
      const { client, registry } = yield* setup();
      const source = makeSource<Item>();
      let server: ReadonlyArray<Item> = [item(1)];
      const q = Query.single({
        key: ["live-refetch"],
        run: Effect.sync(() => server).pipe(Effect.delay("1 second")),
        stream: { updates: source.updates, apply: upsert },
      });
      registry.mount(q);
      yield* settle;
      yield* TestClock.adjust("1 second");
      yield* settle;

      // The refetch reads the server before the update below reaches it.
      server = [item(1), item(3)];
      yield* Effect.forkChild(client.refetchQueries({ queryKey: ["live-refetch"] }));
      yield* settle;
      yield* source.emit(item(2));
      // Shown at once, on the data from before the refetch.
      assert.deepStrictEqual(Option.getOrThrow(registry.get(q).data), [item(1), item(2)]);

      yield* TestClock.adjust("1 second");
      yield* settle;
      assert.deepStrictEqual(Option.getOrThrow(registry.get(q).data), [item(1), item(3), item(2)]);
      assert.deepStrictEqual(
        yield* client.getQueryData(q),
        Option.some([item(1), item(3), item(2)]),
      );
    }),
  );

  it.effect("applies each recorded update with two arguments, in order", () =>
    Effect.gen(function* () {
      const { client, registry } = yield* setup();
      const source = makeSource<number>();
      const q = Query.single({
        key: ["live-max"],
        run: Effect.succeed(1).pipe(Effect.delay("1 second")),
        // `Math.max` takes any number of arguments: extra ones would show.
        stream: { updates: source.updates, apply: Math.max },
      });
      registry.mount(q);
      yield* settle;
      yield* source.emit(5);
      yield* source.emit(3);
      yield* TestClock.adjust("1 second");
      yield* settle;
      assert.deepStrictEqual(yield* client.getQueryData(q), Option.some(5));
    }),
  );

  it.effect("uses the apply of the latest definition", () =>
    Effect.gen(function* () {
      const { client, registry } = yield* setup();
      const source = makeSource<number>();
      const definition = (apply: (total: number, n: number) => number) =>
        Query.single({
          key: ["live-latest"],
          run: Effect.succeed(0),
          stream: { updates: source.updates, apply },
        });
      registry.mount(definition((total, n) => Math.max(total, n)));
      yield* settle;
      // The same key, defined again (a component that closes over new values).
      const latest = definition((total, n) => Math.max(total, n * 10));
      QueryObserver.make(client, latest).subscribe(() => {});
      yield* settle;
      yield* source.emit(2);
      assert.deepStrictEqual(yield* client.getQueryData(latest), Option.some(20));
      assert.strictEqual(source.state.opened, 1);
    }),
  );

  it.effect("keeps updates when a running fetch is cancelled", () =>
    Effect.gen(function* () {
      const { client, registry } = yield* setup();
      const source = makeSource<Item>();
      const q = Query.single({
        key: ["live-cancel"],
        run: Effect.succeed<ReadonlyArray<Item>>([item(1)]).pipe(Effect.delay("1 second")),
        stream: { updates: source.updates, apply: upsert },
      });
      registry.mount(q);
      yield* settle;
      yield* TestClock.adjust("1 second");
      yield* settle;

      yield* Effect.forkChild(client.refetchQueries({ queryKey: ["live-cancel"] }));
      yield* settle;
      yield* source.emit(item(2));
      yield* client.cancelQueries({ queryKey: ["live-cancel"] });
      yield* settle;
      const result = registry.get(q);
      assert.isFalse(result.isFetching);
      assert.deepStrictEqual(Option.getOrThrow(result.data), [item(1), item(2)]);
      assert.strictEqual(result.streamStatus, "open");
    }),
  );

  it.effect("keeps running through resetQueries", () =>
    Effect.gen(function* () {
      const { client, registry } = yield* setup();
      const source = makeSource<Item>();
      const q = Query.single({
        key: ["live-reset"],
        run: Effect.succeed<ReadonlyArray<Item>>([item(1)]),
        stream: { updates: source.updates, apply: upsert },
      });
      registry.mount(q);
      yield* settle;
      yield* source.emit(item(2));

      yield* client.resetQueries({ queryKey: ["live-reset"] });
      yield* settle;
      assert.strictEqual(registry.get(q).streamStatus, "open");
      assert.strictEqual(source.state.opened, 1);
      assert.deepStrictEqual(Option.getOrThrow(registry.get(q).data), [item(1)]);
      yield* source.emit(item(3));
      assert.deepStrictEqual(Option.getOrThrow(registry.get(q).data), [item(1), item(3)]);
    }),
  );
});

describe("stream: lifetime", () => {
  it.effect("does not start for fetchQuery, a disabled query or a built entry", () =>
    Effect.gen(function* () {
      const { client, registry } = yield* setup();
      const source = makeSource<Item>();
      const stream = { updates: source.updates, apply: upsert };
      const run = Effect.succeed<ReadonlyArray<Item>>([]);
      yield* client.fetchQuery(Query.single({ key: ["unobserved"], run, stream }));
      registry.mount(Query.single({ key: ["disabled"], run, stream, enabled: false }));
      yield* settle;
      assert.strictEqual(source.state.opened, 0);
    }),
  );

  it.effect("refetches data that was fetched before the stream ran", () =>
    Effect.gen(function* () {
      const { client, registry } = yield* setup();
      const source = makeSource<Item>();
      const runs = counter();
      const q = Query.single({
        key: ["live-prefetched"],
        run: runs.tick.pipe(Effect.as<ReadonlyArray<Item>>([item(1)])),
        stream: { updates: source.updates, apply: upsert },
        staleTime: "Infinity",
      });
      yield* client.prefetchQuery(q);
      assert.strictEqual(runs.count, 1);
      // Fresh by `staleTime`, but it misses the updates since the prefetch.
      registry.mount(q);
      yield* settle;
      assert.strictEqual(runs.count, 2);
      assert.isFalse(registry.get(q).isStale);
    }),
  );

  it.effect("starts when the definition of an observed query gets a stream", () =>
    Effect.gen(function* () {
      const { client } = yield* setup();
      const source = makeSource<Item>();
      const runs = counter();
      const definition = (live: boolean) =>
        Query.single({
          key: ["live-toggled"],
          run: runs.tick.pipe(Effect.as<ReadonlyArray<Item>>([item(1)])),
          stream: live ? { updates: source.updates, apply: upsert } : undefined,
          staleTime: "Infinity",
        });
      const observer = QueryObserver.make(client, definition(false));
      observer.subscribe(() => {});
      yield* settle;
      assert.strictEqual(source.state.opened, 0);

      observer.setOptions(definition(true));
      yield* settle;
      assert.strictEqual(source.state.opened, 1);
      assert.strictEqual(observer.getCurrentResult().streamStatus, "open");
      // The data from before the stream is refetched.
      assert.strictEqual(runs.count, 2);

      // Back to no stream, and to a stream again before the grace period ends.
      observer.setOptions(definition(false));
      observer.setOptions(definition(true));
      yield* TestClock.adjust("5 seconds");
      yield* settle;
      assert.deepStrictEqual(source.state, { opened: 1, closed: 0 });
    }),
  );

  it.effect("survives a remount within the grace period", () =>
    Effect.gen(function* () {
      const { registry } = yield* setup();
      const source = makeSource<Item>();
      const q = Query.single({
        key: ["live-remount"],
        run: Effect.succeed<ReadonlyArray<Item>>([item(1)]),
        stream: { updates: source.updates, apply: upsert },
        staleTime: "Infinity",
      });
      const unmount = registry.mount(q);
      yield* settle;
      unmount();
      yield* settle;
      yield* TestClock.adjust("900 millis");
      registry.mount(q);
      yield* settle;
      yield* TestClock.adjust("5 seconds");
      yield* settle;
      assert.deepStrictEqual(source.state, { opened: 1, closed: 0 });
      assert.isFalse(registry.get(q).isStale);
    }),
  );

  it.effect("stops after the grace period and invalidates the data", () =>
    Effect.gen(function* () {
      const { client, registry } = yield* setup();
      const source = makeSource<Item>();
      const runs = counter();
      const q = Query.single({
        key: ["live-stop"],
        run: runs.tick.pipe(Effect.as<ReadonlyArray<Item>>([item(1)])),
        stream: { updates: source.updates, apply: upsert },
        staleTime: "Infinity",
      });
      const unmount = registry.mount(q);
      yield* settle;
      unmount();
      yield* settle;
      yield* TestClock.adjust("1 second");
      yield* settle;
      assert.deepStrictEqual(source.state, { opened: 1, closed: 1 });
      const state = Option.getOrThrow(yield* client.getQueryState(q));
      assert.strictEqual(state.streamStatus, "idle");
      assert.isTrue(state.isStale);

      // The next observer refetches, although the data would never go stale by time.
      registry.mount(q);
      yield* settle;
      assert.strictEqual(runs.count, 2);
      assert.deepStrictEqual(source.state, { opened: 2, closed: 1 });
    }),
  );

  it.effect("stops when the entry is removed", () =>
    Effect.gen(function* () {
      const { client, registry } = yield* setup();
      const source = makeSource<Item>();
      const q = Query.single({
        key: ["live-removed"],
        run: Effect.succeed<ReadonlyArray<Item>>([]),
        stream: { updates: source.updates, apply: upsert },
      });
      const unmount = registry.mount(q);
      yield* settle;
      unmount();
      yield* settle;
      yield* client.removeQueries({ queryKey: ["live-removed"] });
      yield* settle;
      assert.deepStrictEqual(source.state, { opened: 1, closed: 1 });
    }),
  );

  it.effect("stops when a definition without a stream replaces the one with it", () =>
    Effect.gen(function* () {
      const { client, registry } = yield* setup();
      const source = makeSource<Item>();
      const run = Effect.succeed<ReadonlyArray<Item>>([]);
      registry.mount(
        Query.single({
          key: ["live-replaced"],
          run,
          stream: { updates: source.updates, apply: upsert },
        }),
      );
      yield* settle;
      yield* client.prefetchQuery(Query.single({ key: ["live-replaced"], run }));
      yield* TestClock.adjust("1 second");
      yield* settle;
      assert.deepStrictEqual(source.state, { opened: 1, closed: 1 });
    }),
  );

  it.effect("waits for the network before it starts", () =>
    Effect.gen(function* () {
      const { registry, online } = yield* setup();
      const source = makeSource<Item>();
      const q = Query.single({
        key: ["live-offline"],
        run: Effect.succeed<ReadonlyArray<Item>>([]),
        stream: { updates: source.updates, apply: upsert },
      });
      online.setOnline(false);
      registry.mount(q);
      yield* settle;
      assert.strictEqual(source.state.opened, 0);
      online.setOnline(true);
      yield* settle;
      assert.strictEqual(source.state.opened, 1);
    }),
  );
});

describe("stream: failures", () => {
  it.effect("retries a failed stream and refetches when it runs again", () =>
    Effect.gen(function* () {
      const { registry } = yield* setup();
      const source = makeSource<Item>();
      const runs = counter();
      const q = Query.single({
        key: ["live-retry"],
        run: runs.tick.pipe(Effect.as<ReadonlyArray<Item>>([item(1)])),
        stream: { updates: source.updates, apply: upsert },
        staleTime: "Infinity",
      });
      registry.mount(q);
      yield* settle;

      yield* source.fail("connection lost");
      const failed = registry.get(q);
      assert.strictEqual(failed.streamStatus, "reconnecting");
      assert.deepStrictEqual(failed.streamError, Option.some("connection lost"));
      // The query itself is untouched: the data is valid, at worst behind.
      assert.strictEqual(failed.status, "success");
      assert.isTrue(Option.isNone(failed.error));
      assert.deepStrictEqual(Option.getOrThrow(failed.data), [item(1)]);
      assert.strictEqual(runs.count, 1);

      // Updates are missed from now on, so the data is stale.
      assert.isTrue(failed.isStale);

      // A new attempt does not refetch yet: it may fail like the last one.
      yield* TestClock.adjust("1 second");
      yield* settle;
      assert.strictEqual(source.state.opened, 2);
      assert.strictEqual(runs.count, 1);
      assert.strictEqual(registry.get(q).streamStatus, "reconnecting");

      // The first update shows that the stream works again: now it refetches.
      yield* source.emit(item(2));
      const recovered = registry.get(q);
      assert.strictEqual(runs.count, 2);
      assert.strictEqual(recovered.streamStatus, "open");
      assert.isTrue(Option.isNone(recovered.streamError));
      assert.isFalse(recovered.isStale);
      assert.deepStrictEqual(Option.getOrThrow(recovered.data), [item(1), item(2)]);
    }),
  );

  it.effect("closes when the retries are used up, and invalidates the data", () =>
    Effect.gen(function* () {
      const { registry } = yield* setup();
      const source = makeSource<Item>();
      const q = Query.single({
        key: ["live-closed"],
        run: Effect.succeed<ReadonlyArray<Item>>([item(1)]),
        stream: { updates: source.updates, apply: upsert, retry: false },
        staleTime: "Infinity",
      });
      registry.mount(q);
      yield* settle;
      yield* source.fail("gone");
      const result = registry.get(q);
      assert.strictEqual(result.streamStatus, "closed");
      assert.deepStrictEqual(result.streamError, Option.some("gone"));
      assert.strictEqual(result.status, "success");
      assert.isTrue(result.isStale);
    }),
  );

  it.effect("starts a closed stream again on resetQueries", () =>
    Effect.gen(function* () {
      const { client, registry } = yield* setup();
      const source = makeSource<Item>();
      const q = Query.single({
        key: ["live-reopened"],
        run: Effect.succeed<ReadonlyArray<Item>>([item(1)]),
        stream: { updates: source.updates, apply: upsert, retry: false },
      });
      registry.mount(q);
      yield* settle;
      yield* source.fail("gone");
      assert.strictEqual(registry.get(q).streamStatus, "closed");

      yield* client.resetQueries({ queryKey: ["live-reopened"] });
      yield* settle;
      const result = registry.get(q);
      assert.strictEqual(result.streamStatus, "open");
      assert.isTrue(Option.isNone(result.streamError));
      assert.strictEqual(source.state.opened, 2);
      yield* source.emit(item(2));
      assert.deepStrictEqual(Option.getOrThrow(registry.get(q).data), [item(1), item(2)]);
    }),
  );

  it.effect("closes without an error when the stream ends", () =>
    Effect.gen(function* () {
      const { registry } = yield* setup();
      const source = makeSource<Item>();
      const q = Query.single({
        key: ["live-ended"],
        run: Effect.succeed<ReadonlyArray<Item>>([item(1)]),
        stream: { updates: source.updates, apply: upsert },
        staleTime: "Infinity",
      });
      registry.mount(q);
      yield* settle;
      yield* source.end;
      const result = registry.get(q);
      assert.strictEqual(result.streamStatus, "closed");
      assert.isTrue(Option.isNone(result.streamError));
      assert.isFalse(result.isStale);
      yield* TestClock.adjust("1 minute");
      assert.strictEqual(source.state.opened, 1);
    }),
  );

  it.effect("reports a defect in the stream as a defect of the query", () =>
    Effect.gen(function* () {
      const { registry } = yield* setup();
      const q = Query.single({
        key: ["live-died"],
        run: Effect.succeed<ReadonlyArray<Item>>([item(1)]),
        stream: { updates: Stream.die(new Error("broken stream")), apply: upsert },
      });
      registry.mount(q);
      yield* settle;
      const result = registry.get(q);
      assert.isTrue(QueryResult.isDefect(result));
      assert.strictEqual(result.streamStatus, "closed");
      yield* TestClock.adjust("1 minute");
      assert.strictEqual(registry.get(q).streamStatus, "closed");
    }),
  );

  it.effect("reports a throwing apply as a defect of the query", () =>
    Effect.gen(function* () {
      const { registry } = yield* setup();
      const source = makeSource<Item>();
      const q = Query.single({
        key: ["live-defect"],
        run: Effect.succeed<ReadonlyArray<Item>>([item(1)]),
        stream: {
          updates: source.updates,
          apply: (items, next) => {
            if (next.id < 0) {
              throw new Error("bad update");
            }
            return upsert(items, next);
          },
        },
      });
      registry.mount(q);
      yield* settle;
      yield* source.emit(item(-1));
      const result = registry.get(q);
      assert.isTrue(QueryResult.isDefect(result));
      assert.strictEqual(result.streamStatus, "closed");
      assert.deepStrictEqual(Option.getOrThrow(result.data), [item(1)]);
    }),
  );
  it.effect("gives fetchQuery the data that goes into the cache", () =>
    Effect.gen(function* () {
      const { client, registry } = yield* setup();
      const source = makeSource<Item>();
      const q = Query.single({
        key: ["live-fetch-query"],
        run: Effect.succeed<ReadonlyArray<Item>>([item(1)]).pipe(Effect.delay("1 second")),
        stream: { updates: source.updates, apply: upsert },
      });
      registry.mount(q);
      yield* settle;
      const fetched = yield* Effect.forkChild(client.fetchQuery(q));
      yield* settle;
      yield* source.emit(item(2));
      yield* TestClock.adjust("1 second");
      yield* settle;
      assert.deepStrictEqual(yield* Fiber.join(fetched), [item(1), item(2)]);
      assert.deepStrictEqual(yield* client.getQueryData(q), Option.some([item(1), item(2)]));
    }),
  );

  it.effect("fails fetchQuery when apply throws on its result", () =>
    Effect.gen(function* () {
      const { client, registry } = yield* setup();
      const source = makeSource<Item>();
      const q = Query.single({
        key: ["live-fetch-query-defect"],
        run: Effect.succeed<ReadonlyArray<Item>>([item(1)]).pipe(Effect.delay("1 second")),
        stream: {
          updates: source.updates,
          apply: (items, next) => {
            if (next.id < 0) {
              throw new Error("bad update");
            }
            return upsert(items, next);
          },
        },
      });
      registry.mount(q);
      yield* settle;
      const fetched = yield* Effect.forkChild(client.fetchQuery(q));
      yield* settle;
      // No data yet, so the update is first applied to the fetch's result.
      yield* source.emit(item(-1));
      yield* TestClock.adjust("1 second");
      yield* settle;
      const exit = yield* Fiber.await(fetched);
      assert.isTrue(Exit.isFailure(exit) && Cause.hasDies(exit.cause));
      assert.isTrue(QueryResult.isDefect(registry.get(q)));
    }),
  );

  it.effect("replaces the first fetch when the stream missed updates during it", () =>
    Effect.gen(function* () {
      const { registry } = yield* setup();
      const source = makeSource<Item>();
      const runs = counter();
      let server: ReadonlyArray<Item> = [];
      const q = Query.single({
        key: ["live-first-fetch"],
        // The request reads the server at once; the response takes a while.
        run: runs.tick.pipe(
          Effect.andThen(Effect.sync(() => server)),
          Effect.tap(() => Effect.sleep("5 seconds")),
        ),
        stream: { updates: source.updates, apply: upsert },
        staleTime: "Infinity",
      });
      registry.mount(q);
      yield* settle;

      // Item 1 is added while the stream is down: nobody is told.
      yield* source.fail("connection lost");
      server = [item(1)];
      yield* TestClock.adjust("1 second");
      yield* settle;
      assert.strictEqual(source.state.opened, 2);
      assert.strictEqual(runs.count, 1);

      // The first fetch is from before the gap, so it cannot be joined.
      yield* source.emit(item(2));
      assert.strictEqual(runs.count, 2);
      yield* TestClock.adjust("5 seconds");
      yield* settle;
      const result = registry.get(q);
      assert.deepStrictEqual(Option.getOrThrow(result.data), [item(1), item(2)]);
      assert.isFalse(result.isStale);
    }),
  );

  it.effect("keeps the data invalidated when the stream closed during the fetch", () =>
    Effect.gen(function* () {
      const { registry } = yield* setup();
      const source = makeSource<Item>();
      const q = Query.single({
        key: ["live-closed-during-fetch"],
        run: Effect.succeed<ReadonlyArray<Item>>([item(1)]).pipe(Effect.delay("1 second")),
        stream: { updates: source.updates, apply: upsert, retry: false },
        staleTime: "Infinity",
      });
      registry.mount(q);
      yield* settle;
      yield* source.fail("gone");
      yield* TestClock.adjust("1 second");
      yield* settle;
      const result = registry.get(q);
      assert.strictEqual(result.status, "success");
      assert.strictEqual(result.streamStatus, "closed");
      // The fetch may be from before the failure: it does not make up for it.
      assert.isTrue(result.isStale);
    }),
  );

  it.effect("keeps the data invalidated when that fetch is cancelled", () =>
    Effect.gen(function* () {
      const { client, registry } = yield* setup();
      const source = makeSource<Item>();
      const q = Query.single({
        key: ["live-closed-then-cancelled"],
        run: Effect.succeed<ReadonlyArray<Item>>([item(1)]).pipe(Effect.delay("1 second")),
        stream: { updates: source.updates, apply: upsert, retry: false },
        staleTime: "Infinity",
      });
      registry.mount(q);
      yield* settle;
      yield* TestClock.adjust("1 second");
      yield* settle;
      assert.isFalse(registry.get(q).isStale);

      yield* Effect.forkChild(client.refetchQueries({ queryKey: ["live-closed-then-cancelled"] }));
      yield* settle;
      yield* source.fail("gone");
      // Cancelling goes back to the state before the fetch, which was fresh.
      yield* client.cancelQueries({ queryKey: ["live-closed-then-cancelled"] });
      yield* settle;
      const result = registry.get(q);
      assert.strictEqual(result.fetchStatus, "idle");
      assert.isTrue(result.isStale);
    }),
  );

  it.effect("applies recorded updates to a fetch that outlasts the stream", () =>
    Effect.gen(function* () {
      const { client, registry } = yield* setup();
      const source = makeSource<Item>();
      const q = Query.single({
        key: ["live-outlasted"],
        run: Effect.succeed<ReadonlyArray<Item>>([item(1)]).pipe(Effect.delay("5 seconds")),
        stream: { updates: source.updates, apply: upsert },
        staleTime: "Infinity",
      });
      const unmount = registry.mount(q);
      yield* settle;
      yield* TestClock.adjust("5 seconds");
      yield* settle;

      yield* Effect.forkChild(client.refetchQueries({ queryKey: ["live-outlasted"] }));
      yield* settle;
      yield* source.emit(item(2));
      unmount();
      yield* settle;
      yield* TestClock.adjust("1 second");
      yield* settle;
      assert.strictEqual(source.state.closed, 1);

      yield* TestClock.adjust("5 seconds");
      yield* settle;
      assert.deepStrictEqual(yield* client.getQueryData(q), Option.some([item(1), item(2)]));
      // The stream stopped during the fetch, so the data is behind from then on.
      assert.isTrue(Option.getOrThrow(yield* client.getQueryState(q)).isStale);
    }),
  );
});

describe("stream: types", () => {
  class Api extends Context.Service<Api, { readonly url: string }>()("test/Api") {}
  class Socket extends Context.Service<Socket, { readonly url: string }>()("test/Socket") {}

  it("keeps the stream's error out of the query's, and adds its services", () => {
    const q = Query.make({
      key: (room: string) => ["room", room],
      run: (room) =>
        Effect.gen(function* () {
          yield* Api;
          return yield* Effect.fail("http" as const).pipe(Effect.as([room]));
        }),
      stream: {
        updates: (room) =>
          Stream.unwrap(
            Effect.as(
              Socket,
              Stream.fail("socket" as const).pipe(Stream.concat(Stream.make(room))),
            ),
          ),
        apply: (rooms, room) => [...rooms, room],
      },
    });
    expectTypeOf(q("a").run).toEqualTypeOf<Effect.Effect<Array<string>, "http", Api | Socket>>();
  });

  it("accepts a stream that is only sometimes there", () => {
    const live = (enabled: boolean) =>
      Query.single({
        key: ["sometimes"],
        run: Effect.succeed(1),
        stream: enabled
          ? { updates: Stream.unwrap(Effect.as(Socket, Stream.make(2))), apply: Math.max }
          : undefined,
      });
    expectTypeOf(live).returns.toEqualTypeOf<Query.QueryAtom<number, never, Socket>>();
  });

  it("leaves a query without a stream as it was, also as an argument", () => {
    const both = (client: QueryClient.Service) =>
      Effect.all([
        client.fetchQuery(Query.single({ key: ["a"], run: Effect.succeed(1) })),
        client.fetchQuery(
          Query.single({
            key: ["b"],
            run: Effect.succeed(1),
            stream: {
              updates: Stream.unwrap(Effect.as(Socket, Stream.make(2))),
              apply: (a, b) => a + b,
            },
            initialData: () => 0,
          }),
        ),
      ]);
    expectTypeOf(both).returns.toEqualTypeOf<Effect.Effect<[number, number], never, Socket>>();
  });
});
