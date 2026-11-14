import { describe, expect, it } from "@effect/vitest";
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

      expect(keys(yield* client.getQueriesData({ queryKey: ["f"] }))).toEqual([
        "fresh",
        "slow",
        "stale",
      ]);
      expect(yield* client.getQueriesData({ queryKey: ["f"], exact: true })).toEqual([]);
      expect(keys(yield* client.getQueriesData({ type: "active" }))).toEqual(["slow"]);
      expect(keys(yield* client.getQueriesData({ type: "inactive" }))).toEqual(["fresh", "stale"]);
      expect(keys(yield* client.getQueriesData({ stale: false }))).toEqual(["fresh"]);
      expect(keys(yield* client.getQueriesData({ stale: true }))).toEqual(["slow", "stale"]);
      expect(yield* client.isFetching({ fetchStatus: "fetching" })).toBe(1);
      expect(keys(yield* client.getQueriesData({ fetchStatus: "idle" }))).toEqual([
        "fresh",
        "stale",
      ]);
      expect(
        keys(
          yield* client.getQueriesData({
            predicate: ({ result }) => Option.getOrUndefined(result.data) === 2,
          }),
        ),
      ).toEqual(["stale"]);
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
      expect([active.count, inactive.count]).toEqual([1, 1]);

      yield* client.invalidateQueries({ queryKey: ["inv"] }, { refetchType: "none" });
      expect([active.count, inactive.count]).toEqual([1, 1]);
      expect((yield* client.getQueriesData({ queryKey: ["inv"], stale: true })).length).toBe(2);

      yield* client.invalidateQueries({ queryKey: ["inv"] }, { refetchType: "inactive" });
      expect([active.count, inactive.count]).toEqual([1, 2]);

      yield* client.invalidateQueries({ queryKey: ["inv"] }, { refetchType: "all" });
      expect([active.count, inactive.count]).toEqual([2, 3]);
    }),
  );

  it.effect("setQueryDefaults replaces earlier defaults for the same key", () =>
    Effect.gen(function* () {
      const { client } = yield* setup({ defaultOptions: { queries: { retry: false } } });
      yield* client.setQueryDefaults(["d"], { staleTime: "1 minute" });
      yield* client.setQueryDefaults(["d"], { staleTime: "2 minutes" });
      yield* client.setQueryDefaults(["other"], { gcTime: "1 second" });
      expect(yield* client.getQueryDefaults(["d", 1])).toEqual({
        retry: false,
        staleTime: "2 minutes",
      });
      expect(yield* client.getQueryDefaults(["x"])).toEqual({ retry: false });
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

      expect(cache.findAll({ mutation: add })).toHaveLength(1);
      expect(cache.findAll({ mutationKey: ["todos"] })).toHaveLength(2);
      expect(cache.findAll({ mutationKey: ["todos"], exact: true })).toHaveLength(1);
      expect(cache.findAll({ mutationKey: ["nope"] })).toHaveLength(0);
      expect(cache.findAll({ status: "success" })).toHaveLength(2);
      expect(yield* client.isMutating()).toBe(1);
      expect(
        cache.findAll({ predicate: (m) => Option.getOrUndefined(m.state.variables) === 2 }),
      ).toHaveLength(1);
      yield* TestClock.adjust("1 second");
      expect(yield* Fiber.join(running)).toBe(3);
      expect(yield* client.isMutating()).toBe(0);
    }),
  );

  it.effect("setMutationDefaults replaces earlier defaults for the same key", () =>
    Effect.gen(function* () {
      const { client } = yield* setup();
      yield* client.setMutationDefaults(["m"], { retry: 1 });
      yield* client.setMutationDefaults(["m"], { retry: 2 });
      expect(yield* client.getMutationDefaults(["m", "x"])).toEqual({ retry: 2 });
      expect(yield* client.getMutationDefaults(["other"])).toEqual({});
    }),
  );
});
