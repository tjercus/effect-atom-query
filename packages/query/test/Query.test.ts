import { assert, describe, it } from "@effect/vitest";
import { Context, Effect, Fiber, Layer, Option, Schedule, Schema } from "effect";
import { TestClock } from "effect/testing";
import { Query, QueryClient, QueryKey, QueryResult } from "../src/index.ts";
import { counter, settle, setup } from "./utils.ts";

class NotFound extends Schema.TaggedError<NotFound>()("NotFound", { id: Schema.Number }) {}

describe("QueryClient.fetchQuery", () => {
  it.effect("fetches, caches and returns fresh data without refetching", () =>
    Effect.gen(function* () {
      const { client } = yield* setup();
      const runs = counter();
      const todo = Query.make({
        key: (id: number) => ["todo", id],
        run: (id) => runs.tick.pipe(Effect.as({ id, title: `todo ${id}` })),
        staleTime: "1 minute",
      });

      assert.deepStrictEqual(yield* client.fetchQuery(todo(1)), { id: 1, title: "todo 1" });
      assert.deepStrictEqual(yield* client.fetchQuery(todo(1)), { id: 1, title: "todo 1" });
      assert.strictEqual(runs.count, 1);

      yield* TestClock.adjust("2 minutes");
      yield* client.fetchQuery(todo(1));
      assert.strictEqual(runs.count, 2);
    }),
  );

  it.effect("deduplicates concurrent fetches of the same key", () =>
    Effect.gen(function* () {
      const { client } = yield* setup();
      const runs = counter();
      const slow = Query.single({ key: ["slow"], run: runs.tick.pipe(Effect.delay("1 second")) });

      const a = yield* Effect.forkChild(client.fetchQuery(slow));
      const b = yield* Effect.forkChild(client.fetchQuery(slow));
      yield* settle;
      assert.strictEqual(yield* client.isFetching(), 1);
      yield* TestClock.adjust("1 second");
      assert.deepStrictEqual([yield* Fiber.join(a), yield* Fiber.join(b)], [1, 1]);
      assert.strictEqual(runs.count, 1);
    }),
  );

  it.effect("fails with the typed error and does not retry by default", () =>
    Effect.gen(function* () {
      const { client } = yield* setup();
      const runs = counter();
      const missing = Query.make({
        key: (id: number) => ["missing", id],
        run: (id) => runs.tick.pipe(Effect.andThen(Effect.fail(new NotFound({ id })))),
      });
      const error = yield* client.fetchQuery(missing(7)).pipe(Effect.flip);
      assert.deepStrictEqual(error, new NotFound({ id: 7 }));
      assert.strictEqual(runs.count, 1);
    }),
  );

  it.effect("ensureQueryData returns stale cached data without fetching", () =>
    Effect.gen(function* () {
      const { client } = yield* setup();
      const runs = counter();
      const q = Query.single({ key: ["ensure"], run: runs.tick });
      yield* client.fetchQuery(q);
      yield* TestClock.adjust("1 minute");
      assert.strictEqual(yield* client.ensureQueryData(q), 1);
      assert.strictEqual(runs.count, 1);
    }),
  );

  it.effect("getQueryData is typed by the query or a tagged key", () =>
    Effect.gen(function* () {
      const { client } = yield* setup();
      const todo = Query.make({
        key: (id: number) => ["todo", id],
        run: (id) => Effect.succeed({ id }),
      });
      assert.deepStrictEqual(yield* client.getQueryData(todo(1)), Option.none());
      yield* client.prefetchQuery(todo(1));
      const data: Option.Option<{ id: number }> = yield* client.getQueryData(todo.key(1));
      assert.deepStrictEqual(data, Option.some({ id: 1 }));
      assert.deepStrictEqual(
        yield* client.getQueryData(QueryKey.tagged<{ id: number }>(["todo", 1])),
        Option.some({ id: 1 }),
      );
    }),
  );

  it.effect("runs queries with services from the caller and from the client's layer", () =>
    Effect.gen(function* () {
      class Greeter extends Context.Service<
        Greeter,
        { readonly greet: (name: string) => string }
      >()("test/Greeter") {}
      const greeting = Query.make({
        key: (name: string) => ["greeting", name],
        run: (name) => Effect.map(Greeter, (g) => g.greet(name)),
      });
      const GreeterLive = Layer.succeed(Greeter, Greeter.of({ greet: (name) => `hello ${name}` }));

      // fetchQuery requires Greeter statically: Effect<string, never, Greeter>
      const viaCaller = yield* QueryClient.make().pipe(
        Effect.flatMap((client) => client.fetchQuery(greeting("ada"))),
        Effect.provide(GreeterLive),
      );
      assert.strictEqual(viaCaller, "hello ada");

      // A client built inside the layer runs atom-triggered fetches with Greeter.
      const viaLayer = yield* Effect.gen(function* () {
        const client = yield* QueryClient.QueryClient;
        return yield* client.fetchQuery(greeting("lin"));
      }).pipe(Effect.provide(QueryClient.layer().pipe(Layer.provideMerge(GreeterLive))));
      assert.strictEqual(viaLayer, "hello lin");
    }),
  );
});

describe("query atoms", () => {
  it.effect("fetch on mount and move from pending to success", () =>
    Effect.gen(function* () {
      const { registry } = yield* setup();
      const q = Query.single({
        key: ["mount"],
        run: Effect.succeed("data").pipe(Effect.delay("1 second")),
      });

      const unmount = registry.mount(q);
      const loading = registry.get(q);
      assert.strictEqual(loading.status, "pending");
      assert.isTrue(loading.isLoading);
      assert.strictEqual(loading.fetchStatus, "fetching");

      yield* TestClock.adjust("1 second");
      yield* settle;
      const done = registry.get(q);
      assert(done.isSuccess);
      assert.strictEqual(done.data.value, "data");
      assert.isFalse(done.isFetching);
      assert.isTrue(done.isStale); // staleTime 0
      assert.isTrue(Option.isSome(done.dataUpdatedAt));
      unmount();
    }),
  );

  it.effect("share one cache entry and one fetch across atoms with equal keys", () =>
    Effect.gen(function* () {
      const { registry } = yield* setup();
      const runs = counter();
      const todos = Query.make({
        key: (f: { done: boolean }) => ["todos", f],
        run: () => runs.tick,
      });
      assert.strictEqual(todos({ done: true }), todos({ done: true })); // memoised structurally
      registry.mount(todos({ done: true }));
      registry.mount(todos({ done: true }));
      yield* settle;
      assert.strictEqual(runs.count, 1);
    }),
  );

  it.effect("respect staleTime on remount and flip isStale when it elapses", () =>
    Effect.gen(function* () {
      const { registry } = yield* setup({
        defaultOptions: { queries: { staleTime: "30 seconds" } },
      });
      const runs = counter();
      const q = Query.single({ key: ["stale"], run: runs.tick });

      const unmount = registry.mount(q);
      yield* settle;
      assert.isFalse(registry.get(q).isStale);
      unmount();
      yield* settle;

      registry.mount(q); // fresh: no refetch
      yield* settle;
      assert.strictEqual(runs.count, 1);

      yield* TestClock.adjust("30 seconds");
      yield* settle;
      assert.isTrue(registry.get(q).isStale); // stale timer notified the atom
    }),
  );

  it.effect("refetch on remount when stale", () =>
    Effect.gen(function* () {
      const { registry } = yield* setup();
      const runs = counter();
      const q = Query.single({ key: ["remount"], run: runs.tick });
      registry.mount(q)();
      yield* settle;
      registry.mount(q);
      yield* settle;
      assert.strictEqual(runs.count, 2);
      const result = registry.get(q);
      assert(result.isSuccess);
      assert.strictEqual(result.data.value, 2);
    }),
  );

  it.effect("garbage collect unobserved entries after gcTime (default 5 minutes)", () =>
    Effect.gen(function* () {
      const { client, registry } = yield* setup();
      const q = Query.single({ key: ["gc"], run: Effect.succeed(1) });
      const unmount = registry.mount(q);
      yield* settle;
      unmount();
      yield* settle;

      yield* TestClock.adjust("4 minutes");
      assert.isTrue(Option.isSome(yield* client.getQueryData(q)));

      registry.mount(q)(); // re-observing resets the timer
      yield* settle;
      yield* TestClock.adjust("4 minutes");
      assert.isTrue(Option.isSome(yield* client.getQueryData(q)));

      yield* TestClock.adjust("1 minute");
      yield* settle;
      assert.deepStrictEqual(yield* client.getQueryData(q), Option.none());
    }),
  );

  it.effect("retry 3 times with exponential backoff, then expose the typed error", () =>
    Effect.gen(function* () {
      const { registry } = yield* setup();
      const runs = counter();
      const q = Query.single({
        key: ["retry"],
        run: runs.tick.pipe(Effect.andThen(Effect.fail(new NotFound({ id: 1 })))),
      });
      registry.mount(q);
      yield* settle;
      assert.strictEqual(runs.count, 1);
      let r = registry.get(q);
      assert.strictEqual(r.status, "pending"); // still retrying silently
      assert.strictEqual(r.failureCount, 1);
      assert.deepStrictEqual(r.failureReason, Option.some(new NotFound({ id: 1 })));

      yield* TestClock.adjust("1 second");
      yield* settle;
      assert.strictEqual(runs.count, 2);
      yield* TestClock.adjust("2 seconds");
      yield* settle;
      assert.strictEqual(runs.count, 3);
      yield* TestClock.adjust("4 seconds");
      yield* settle;
      assert.strictEqual(runs.count, 4);

      r = registry.get(q);
      assert(r.isError);
      assert.deepStrictEqual(r.error, Option.some(new NotFound({ id: 1 })));
      assert.isTrue(r.isLoadingError);
      assert.strictEqual(r.failureCount, 4);
      assert.isFalse(QueryResult.isDefect(r));
    }),
  );

  it.effect("accept a number, false, or any Schedule as retry policy", () =>
    Effect.gen(function* () {
      const { registry } = yield* setup();
      const none = counter();
      const custom = counter();
      const qNone = Query.single({
        key: ["r0"],
        run: none.tick.pipe(Effect.andThen(Effect.fail("x"))),
        retry: false,
      });
      const qCustom = Query.single({
        key: ["r1"],
        run: custom.tick.pipe(Effect.andThen(Effect.fail("x"))),
        retry: Schedule.spaced("10 millis").pipe(Schedule.upTo({ times: 5 })),
      });
      registry.mount(qNone);
      registry.mount(qCustom);
      yield* settle;
      for (let i = 0; i < 5; i++) {
        yield* TestClock.adjust("10 millis");
        yield* settle;
      }
      assert.strictEqual(none.count, 1);
      assert.strictEqual(custom.count, 6);
      assert.isTrue(registry.get(qNone).isError);
    }),
  );

  it.effect("do not retry defects; they surface as a defect result", () =>
    Effect.gen(function* () {
      const { registry } = yield* setup();
      const runs = counter();
      const q = Query.single({
        key: ["die"],
        run: runs.tick.pipe(Effect.andThen(Effect.die("boom"))),
      });
      registry.mount(q);
      yield* settle;
      const r = registry.get(q);
      assert(r.isError);
      assert.isTrue(QueryResult.isDefect(r));
      assert.deepStrictEqual(r.error, Option.none());
      assert.strictEqual(runs.count, 1);
    }),
  );

  it.effect("keep previous data when a refetch fails", () =>
    Effect.gen(function* () {
      const { registry } = yield* setup();
      let fail = false;
      const q = Query.single({
        key: ["refetch-error"],
        run: Effect.suspend(() => (fail ? Effect.fail("nope") : Effect.succeed("ok"))),
        retry: false,
      });
      registry.mount(q);
      yield* settle;
      fail = true;
      registry.refresh(q);
      yield* settle;
      const r = registry.get(q);
      assert(r.isError);
      assert.isTrue(r.isRefetchError);
      assert.deepStrictEqual(r.data, Option.some("ok"));
    }),
  );

  it.effect("refresh forces a refetch even when fresh", () =>
    Effect.gen(function* () {
      const { registry } = yield* setup();
      const runs = counter();
      const q = Query.single({ key: ["refresh"], run: runs.tick, staleTime: "static" });
      registry.mount(q);
      yield* settle;
      registry.refresh(q);
      yield* settle;
      assert.strictEqual(runs.count, 2);
    }),
  );

  it.effect("enabled: false and skipToken never fetch", () =>
    Effect.gen(function* () {
      const { registry } = yield* setup();
      const runs = counter();
      const todo = Query.make({
        key: (id: number) => ["todo", id],
        run: () => runs.tick,
        enabled: (id) => id > 0,
      });
      registry.mount(todo(0));
      const skipped = todo(Query.skipToken);
      registry.mount(skipped);
      yield* settle;
      assert.strictEqual(runs.count, 0);
      assert.deepInclude(registry.get(todo(0)), {
        status: "pending",
        fetchStatus: "idle",
        isEnabled: false,
      });
      assert.deepInclude(registry.get(skipped), {
        status: "pending",
        fetchStatus: "idle",
        isEnabled: false,
      });
    }),
  );

  it.effect("rebuild against a new entry after removeQueries", () =>
    Effect.gen(function* () {
      const { client, registry } = yield* setup();
      const runs = counter();
      const q = Query.single({ key: ["removed"], run: runs.tick });
      registry.mount(q);
      yield* settle;
      yield* client.removeQueries({ queryKey: ["removed"] });
      yield* settle;
      assert.strictEqual(runs.count, 2);
      assert.deepStrictEqual(yield* client.getQueryData(q), Option.some(2));
    }),
  );

  it.effect("die with a helpful message without a client", () =>
    Effect.sync(() => {
      const q = Query.single({ key: ["orphan"], run: Effect.succeed(1) });
      assert.throws(() => AtomRegistryMake().get(q), QueryClient.MissingQueryClientError);
    }),
  );
});

import { AtomRegistry } from "effect/reactivity";
const AtomRegistryMake = () => AtomRegistry.make();
