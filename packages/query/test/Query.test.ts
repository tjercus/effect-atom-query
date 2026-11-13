import { assert, describe, expect, it } from "@effect/vitest";
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

      expect(yield* client.fetchQuery(todo(1))).toEqual({ id: 1, title: "todo 1" });
      expect(yield* client.fetchQuery(todo(1))).toEqual({ id: 1, title: "todo 1" });
      expect(runs.count).toBe(1);

      yield* TestClock.adjust("2 minutes");
      yield* client.fetchQuery(todo(1));
      expect(runs.count).toBe(2);
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
      expect(yield* client.isFetching()).toBe(1);
      yield* TestClock.adjust("1 second");
      expect([yield* Fiber.join(a), yield* Fiber.join(b)]).toEqual([1, 1]);
      expect(runs.count).toBe(1);
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
      expect(error).toEqual(new NotFound({ id: 7 }));
      expect(runs.count).toBe(1);
    }),
  );

  it.effect("ensureQueryData returns stale cached data without fetching", () =>
    Effect.gen(function* () {
      const { client } = yield* setup();
      const runs = counter();
      const q = Query.single({ key: ["ensure"], run: runs.tick });
      yield* client.fetchQuery(q);
      yield* TestClock.adjust("1 minute");
      expect(yield* client.ensureQueryData(q)).toBe(1);
      expect(runs.count).toBe(1);
    }),
  );

  it.effect("getQueryData is typed by the query or a tagged key", () =>
    Effect.gen(function* () {
      const { client } = yield* setup();
      const todo = Query.make({
        key: (id: number) => ["todo", id],
        run: (id) => Effect.succeed({ id }),
      });
      expect(yield* client.getQueryData(todo(1))).toEqual(Option.none());
      yield* client.prefetchQuery(todo(1));
      const data: Option.Option<{ id: number }> = yield* client.getQueryData(todo.key(1));
      expect(data).toEqual(Option.some({ id: 1 }));
      expect(yield* client.getQueryData(QueryKey.tagged<{ id: number }>(["todo", 1]))).toEqual(
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
      expect(viaCaller).toBe("hello ada");

      // A client built inside the layer runs atom-triggered fetches with Greeter.
      const viaLayer = yield* Effect.gen(function* () {
        const client = yield* QueryClient.QueryClient;
        return yield* client.fetchQuery(greeting("lin"));
      }).pipe(Effect.provide(QueryClient.layer().pipe(Layer.provideMerge(GreeterLive))));
      expect(viaLayer).toBe("hello lin");
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
      expect(loading.status).toBe("pending");
      expect(loading.isLoading).toBe(true);
      expect(loading.fetchStatus).toBe("fetching");

      yield* TestClock.adjust("1 second");
      yield* settle;
      const done = registry.get(q);
      assert(done.isSuccess);
      expect(done.data.value).toBe("data");
      expect(done.isFetching).toBe(false);
      expect(done.isStale).toBe(true); // staleTime 0
      expect(Option.isSome(done.dataUpdatedAt)).toBe(true);
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
      expect(todos({ done: true })).toBe(todos({ done: true })); // memoised structurally
      registry.mount(todos({ done: true }));
      registry.mount(todos({ done: true }));
      yield* settle;
      expect(runs.count).toBe(1);
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
      expect(registry.get(q).isStale).toBe(false);
      unmount();
      yield* settle;

      registry.mount(q); // fresh: no refetch
      yield* settle;
      expect(runs.count).toBe(1);

      yield* TestClock.adjust("30 seconds");
      yield* settle;
      expect(registry.get(q).isStale).toBe(true); // stale timer notified the atom
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
      expect(runs.count).toBe(2);
      const result = registry.get(q);
      assert(result.isSuccess);
      expect(result.data.value).toBe(2);
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
      expect(Option.isSome(yield* client.getQueryData(q))).toBe(true);

      registry.mount(q)(); // re-observing resets the timer
      yield* settle;
      yield* TestClock.adjust("4 minutes");
      expect(Option.isSome(yield* client.getQueryData(q))).toBe(true);

      yield* TestClock.adjust("1 minute");
      yield* settle;
      expect(yield* client.getQueryData(q)).toEqual(Option.none());
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
      expect(runs.count).toBe(1);
      let r = registry.get(q);
      expect(r.status).toBe("pending"); // still retrying silently
      expect(r.failureCount).toBe(1);
      expect(r.failureReason).toEqual(Option.some(new NotFound({ id: 1 })));

      yield* TestClock.adjust("1 second");
      yield* settle;
      expect(runs.count).toBe(2);
      yield* TestClock.adjust("2 seconds");
      yield* settle;
      expect(runs.count).toBe(3);
      yield* TestClock.adjust("4 seconds");
      yield* settle;
      expect(runs.count).toBe(4);

      r = registry.get(q);
      assert(r.isError);
      expect(r.error).toEqual(Option.some(new NotFound({ id: 1 })));
      expect(r.isLoadingError).toBe(true);
      expect(r.failureCount).toBe(4);
      expect(QueryResult.isDefect(r)).toBe(false);
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
      expect(none.count).toBe(1);
      expect(custom.count).toBe(6);
      expect(registry.get(qNone).isError).toBe(true);
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
      expect(QueryResult.isDefect(r)).toBe(true);
      expect(r.error).toEqual(Option.none());
      expect(runs.count).toBe(1);
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
      expect(r.isRefetchError).toBe(true);
      expect(r.data).toEqual(Option.some("ok"));
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
      expect(runs.count).toBe(2);
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
      expect(runs.count).toBe(0);
      expect(registry.get(todo(0))).toMatchObject({
        status: "pending",
        fetchStatus: "idle",
        isEnabled: false,
      });
      expect(registry.get(skipped)).toMatchObject({
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
      expect(runs.count).toBe(2);
      expect(yield* client.getQueryData(q)).toEqual(Option.some(2));
    }),
  );

  it.effect("die with a helpful message without a client", () =>
    Effect.sync(() => {
      const q = Query.single({ key: ["orphan"], run: Effect.succeed(1) });
      expect(() => AtomRegistryMake().get(q)).toThrow(QueryClient.MissingQueryClientError);
    }),
  );
});

import { AtomRegistry } from "effect/reactivity";
const AtomRegistryMake = () => AtomRegistry.make();
