import { assert, describe, it } from "@effect/vitest";
import { Effect, Fiber, Option } from "effect";
import { TestClock } from "effect/testing";
import { Mutation, Query, QueryObserver } from "../src/index.ts";
import { counter, settle, setup } from "./utils.ts";

const keys = (entries: ReadonlyArray<readonly [ReadonlyArray<unknown>, unknown]>) =>
  entries.map(([key]) => String(key[1])).sort((a, b) => a.localeCompare(b));

describe("query filters", () => {
  it.effect("select by key, exactness, activity, staleness, fetch status and predicate", () =>
    Effect.gen(function* () {
      const { client } = yield* setup();
      const fresh = Query.single({
        key: ["f", "fresh"],
        run: Effect.succeed(1),
        staleTime: "1 hour",
      });
      const stale = Query.single({ key: ["f", "stale"], run: Effect.succeed(2) });
      const slow = Query.single({
        key: ["f", "slow"],
        run: Effect.succeed(3).pipe(Effect.delay("1 second")),
      });
      yield* client.fetchQuery(fresh);
      yield* client.fetchQuery(stale);
      QueryObserver.make(client, slow).subscribe(() => {});
      yield* settle;

      assert.deepStrictEqual(keys(yield* client.getQueriesData({ queryKey: ["f"] })), [
        "fresh",
        "slow",
        "stale",
      ]);
      assert.deepStrictEqual(yield* client.getQueriesData({ queryKey: ["f"], exact: true }), []);
      assert.deepStrictEqual(keys(yield* client.getQueriesData({ type: "active" })), ["slow"]);
      assert.deepStrictEqual(keys(yield* client.getQueriesData({ type: "inactive" })), [
        "fresh",
        "stale",
      ]);
      assert.deepStrictEqual(keys(yield* client.getQueriesData({ stale: false })), ["fresh"]);
      assert.deepStrictEqual(keys(yield* client.getQueriesData({ stale: true })), [
        "slow",
        "stale",
      ]);
      assert.strictEqual(yield* client.isFetching({ fetchStatus: "fetching" }), 1);
      assert.deepStrictEqual(keys(yield* client.getQueriesData({ fetchStatus: "idle" })), [
        "fresh",
        "stale",
      ]);
      assert.deepStrictEqual(
        keys(
          yield* client.getQueriesData({
            predicate: ({ result }) => Option.getOrUndefined(result.data) === 2,
          }),
        ),
        ["stale"],
      );
      yield* TestClock.adjust("1 second");
    }),
  );

  it.effect("invalidateQueries refetchType: none, inactive and all", () =>
    Effect.gen(function* () {
      const { client } = yield* setup();
      const active = counter();
      const inactive = counter();
      const a = Query.single({ key: ["inv", "active"], run: active.tick });
      const b = Query.single({ key: ["inv", "inactive"], run: inactive.tick });
      QueryObserver.make(client, a).subscribe(() => {});
      yield* client.fetchQuery(b);
      yield* settle;
      assert.deepStrictEqual([active.count, inactive.count], [1, 1]);

      yield* client.invalidateQueries({ queryKey: ["inv"] }, { refetchType: "none" });
      assert.deepStrictEqual([active.count, inactive.count], [1, 1]);
      assert.strictEqual(
        (yield* client.getQueriesData({ queryKey: ["inv"], stale: true })).length,
        2,
      );

      yield* client.invalidateQueries({ queryKey: ["inv"] }, { refetchType: "inactive" });
      assert.deepStrictEqual([active.count, inactive.count], [1, 2]);

      yield* client.invalidateQueries({ queryKey: ["inv"] }, { refetchType: "all" });
      assert.deepStrictEqual([active.count, inactive.count], [2, 3]);
    }),
  );

  it.effect("setQueryDefaults replaces earlier defaults for the same key", () =>
    Effect.gen(function* () {
      const { client } = yield* setup({ defaultOptions: { queries: { retry: false } } });
      yield* client.setQueryDefaults(["d"], { staleTime: "1 minute" });
      yield* client.setQueryDefaults(["d"], { staleTime: "2 minutes" });
      yield* client.setQueryDefaults(["other"], { gcTime: "1 second" });
      assert.deepStrictEqual(yield* client.getQueryDefaults(["d", 1]), {
        retry: false,
        staleTime: "2 minutes",
      });
      assert.deepStrictEqual(yield* client.getQueryDefaults(["x"]), { retry: false });
    }),
  );
});

describe("mutation filters", () => {
  it.effect("select by mutation atom, key, exactness, status and predicate", () =>
    Effect.gen(function* () {
      const { client } = yield* setup();
      const add = Mutation.make({ key: ["todos", "add"], run: (n: number) => Effect.succeed(n) });
      const remove = Mutation.make({ key: ["todos"], run: (n: number) => Effect.succeed(n) });
      const anonymous = Mutation.make({
        run: (n: number) => Effect.succeed(n).pipe(Effect.delay("1 second")),
      });
      yield* client.mutate(add, 1);
      yield* client.mutate(remove, 2);
      const running = yield* Effect.forkChild(client.mutate(anonymous, 3));
      yield* settle;
      const cache = client.mutationCache;

      assert.lengthOf(cache.findAll({ mutation: add }), 1);
      assert.lengthOf(cache.findAll({ mutationKey: ["todos"] }), 2);
      assert.lengthOf(cache.findAll({ mutationKey: ["todos"], exact: true }), 1);
      assert.lengthOf(cache.findAll({ mutationKey: ["nope"] }), 0);
      assert.lengthOf(cache.findAll({ status: "success" }), 2);
      assert.strictEqual(yield* client.isMutating(), 1);
      assert.lengthOf(
        cache.findAll({ predicate: (m) => Option.getOrUndefined(m.state.variables) === 2 }),
        1,
      );
      yield* TestClock.adjust("1 second");
      assert.strictEqual(yield* Fiber.join(running), 3);
      assert.strictEqual(yield* client.isMutating(), 0);
    }),
  );

  it.effect("setMutationDefaults replaces earlier defaults for the same key", () =>
    Effect.gen(function* () {
      const { client } = yield* setup();
      yield* client.setMutationDefaults(["m"], { retry: 1 });
      yield* client.setMutationDefaults(["m"], { retry: 2 });
      assert.deepStrictEqual(yield* client.getMutationDefaults(["m", "x"]), { retry: 2 });
      assert.deepStrictEqual(yield* client.getMutationDefaults(["other"]), {});
    }),
  );
});
