/**
 * Request-time options that leave the cache key alone: `Query.FetchAttempt`
 * on every attempt, and the caller's services on every refetch.
 */
import { assert, describe, it } from "@effect/vitest";
import { Context, Deferred, Effect, Fiber, Schedule } from "effect";
import { Mutation, Query, QueryObserver } from "../src/index.ts";
import { settle, setup } from "./utils.ts";

/** A request option, as an application would declare it. */
const BypassCache = Context.Reference<boolean>("test/BypassCache", {
  defaultValue: () => false,
});

/** A query that records the `BypassCache` value of every run. */
const recordingQuery = (key: string) => {
  const seen: Array<boolean> = [];
  const query = Query.single({
    key: [key],
    run: Effect.gen(function* () {
      const bypass = yield* BypassCache;
      seen.push(bypass);
      return seen.length;
    }),
  });
  return { query, seen };
};

describe("Query.FetchAttempt", () => {
  it.effect("counts the attempts of a fetch, from 0", () =>
    Effect.gen(function* () {
      const { client } = yield* setup();
      const attempts: Array<number> = [];
      const q = Query.single({
        key: ["attempts"],
        run: Effect.gen(function* () {
          const { attempt } = yield* Query.FetchAttempt;
          attempts.push(attempt);
          return attempt < 2 ? yield* Effect.fail("flaky") : "ok";
        }),
      });
      const value = yield* client.fetchQuery(q, { retry: Schedule.recurs(3) });
      assert.strictEqual(value, "ok");
      assert.deepStrictEqual(attempts, [0, 1, 2]);
    }),
  );

  it.effect("starts again from 0 on the next fetch", () =>
    Effect.gen(function* () {
      const { client } = yield* setup();
      const attempts: Array<number> = [];
      const q = Query.single({
        key: ["attempts-again"],
        run: Effect.gen(function* () {
          const { attempt } = yield* Query.FetchAttempt;
          attempts.push(attempt);
          return attempt;
        }),
      });
      yield* client.fetchQuery(q);
      yield* client.refetchQueries({ queryKey: ["attempts-again"] });
      assert.deepStrictEqual(attempts, [0, 0]);
    }),
  );

  it.effect("reads attempt 0 outside a fetch", () =>
    Effect.gen(function* () {
      assert.deepStrictEqual(yield* Query.FetchAttempt, { attempt: 0 });
    }),
  );
});

describe("caller services on refetches", () => {
  it.effect("refetchQueries runs the fetch with the caller's services, in the same entry", () =>
    Effect.gen(function* () {
      const { client } = yield* setup();
      const { query, seen } = recordingQuery("refetch-services");
      yield* client.fetchQuery(query);
      // The call the guides show.
      yield* client
        .refetchQueries({ queryKey: query.key, exact: true })
        .pipe(Effect.provideService(BypassCache, true));
      assert.deepStrictEqual(seen, [false, true]);
      assert.strictEqual(client.cache.findAll({ queryKey: ["refetch-services"] }).length, 1);
      assert.strictEqual(client.cache.build(query).state.data._tag, "Some");
    }),
  );

  it.effect("invalidateQueries refetches active queries with the caller's services", () =>
    Effect.gen(function* () {
      const { client } = yield* setup();
      const { query, seen } = recordingQuery("invalidate-services");
      QueryObserver.make(client, query).subscribe(() => {});
      yield* settle;
      yield* client
        .invalidateQueries({ queryKey: ["invalidate-services"] })
        .pipe(Effect.provideService(BypassCache, true));
      assert.deepStrictEqual(seen, [false, true]);
    }),
  );

  it.effect("resetQueries refetches active queries with the caller's services", () =>
    Effect.gen(function* () {
      const { client } = yield* setup();
      const { query, seen } = recordingQuery("reset-services");
      QueryObserver.make(client, query).subscribe(() => {});
      yield* settle;
      yield* client
        .resetQueries({ queryKey: ["reset-services"] })
        .pipe(Effect.provideService(BypassCache, true));
      assert.deepStrictEqual(seen, [false, true]);
    }),
  );

  it.effect("fetches nobody asked for use the defaults", () =>
    Effect.gen(function* () {
      const { client } = yield* setup();
      const { query, seen } = recordingQuery("default-services");
      yield* client.fetchQuery(query);
      yield* client
        .refetchQueries({ queryKey: ["default-services"] })
        .pipe(Effect.provideService(BypassCache, true));
      // An observer mounting later fetches with the client's services only.
      yield* client.invalidateQueries({ queryKey: ["default-services"] }, { refetchType: "none" });
      QueryObserver.make(client, query).subscribe(() => {});
      yield* settle;
      assert.deepStrictEqual(seen, [false, true, false]);
    }),
  );

  it.effect("a refetch during the first load joins it, keeping its services", () =>
    Effect.gen(function* () {
      const { client } = yield* setup();
      const gate = yield* Deferred.make<void>();
      const seen: Array<boolean> = [];
      const q = Query.single({
        key: ["join-first-load"],
        run: Effect.gen(function* () {
          seen.push(yield* BypassCache);
          yield* Deferred.await(gate);
          return seen.length;
        }),
      });
      const first = yield* Effect.forkChild(client.fetchQuery(q));
      yield* settle;
      // No data yet: even with the default cancelRefetch, the refetch joins.
      const refetch = yield* Effect.forkChild(
        client
          .refetchQueries({ queryKey: q.key, exact: true })
          .pipe(Effect.provideService(BypassCache, true)),
      );
      yield* settle;
      yield* Deferred.succeed(gate, undefined);
      yield* Fiber.join(first);
      yield* Fiber.join(refetch);
      assert.deepStrictEqual(seen, [false]);
    }),
  );

  it.effect("a mutation's invalidates refetch with the services of the mutate call", () =>
    Effect.gen(function* () {
      const { client } = yield* setup();
      const { query, seen } = recordingQuery("mutation-services");
      QueryObserver.make(client, query).subscribe(() => {});
      yield* settle;
      const save = Mutation.make({
        key: ["save"],
        run: () => Effect.void,
        invalidates: [["mutation-services"]],
      });
      yield* client.mutate(save, undefined).pipe(Effect.provideService(BypassCache, true));
      yield* settle;
      assert.deepStrictEqual(seen, [false, true]);
    }),
  );
});
