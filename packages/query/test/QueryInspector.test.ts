import { assert, describe, it } from "@effect/vitest";
import { Duration, Effect, Option } from "effect";
import { TestClock } from "effect/testing";
import { Mutation, Query, QueryInspector, QueryObserver } from "../src/index.ts";
import { settle, setup } from "./utils.ts";

describe("QueryInspector", () => {
  it.effect("snapshots queries and mutations", () =>
    Effect.gen(function* () {
      const { client } = yield* setup();
      const todos = Query.single({
        key: ["todos"],
        run: Effect.succeed(["a"]),
        staleTime: "1 minute",
      });
      const broken = Query.single({ key: ["broken"], run: Effect.fail("nope") });
      yield* client.fetchQuery(todos);
      yield* Effect.exit(client.fetchQuery(broken));
      const add = Mutation.make({ key: ["add"], run: (title: string) => Effect.succeed(title) });
      yield* client.mutate(add, "b");

      const queries = QueryInspector.queries(client);
      const t = queries.find((q) => q.hash === '["todos"]')!;
      assert.strictEqual(t.status, "success");
      assert.deepStrictEqual(t.data, Option.some(["a"]));
      assert.isFalse(t.isStale);
      assert.strictEqual(t.staleTime, 60_000);
      assert.strictEqual(t.observers, 0);
      const b = queries.find((q) => q.hash === '["broken"]')!;
      assert.strictEqual(b.status, "error");
      assert.include(Option.getOrThrow(b.error), "nope");

      const [m] = QueryInspector.mutations(client);
      assert.strictEqual(m!.status, "success");
      assert.deepStrictEqual(m!.variables, Option.some("b"));
      assert.deepStrictEqual(m!.key, Option.some(["add"]));
    }),
  );

  it.effect("notifies on changes and runs actions", () =>
    Effect.gen(function* () {
      const { client } = yield* setup();
      let n = 0;
      const q = Query.single({ key: ["n"], run: Effect.sync(() => ++n), staleTime: "1 hour" });
      let notified = 0;
      const unsubscribe = QueryInspector.subscribe(client, () => notified++);
      yield* client.fetchQuery(q);
      yield* settle;
      assert.isAbove(notified, 0);

      yield* QueryInspector.action(client, ["n"], "invalidate");
      assert.isTrue(QueryInspector.queries(client)[0]!.isInvalidated);
      yield* QueryInspector.action(client, ["n"], "refetch");
      assert.deepStrictEqual(QueryInspector.queries(client)[0]!.data, Option.some(2));
      yield* QueryInspector.action(client, ["n"], "remove");
      assert.lengthOf(QueryInspector.queries(client), 0);
      unsubscribe();
    }),
  );

  it.effect("snapshots bigint keys, static and infinite times, and pending queries", () =>
    Effect.gen(function* () {
      const { client } = yield* setup();
      const big = Query.single({
        key: ["big", 10n],
        run: Effect.succeed(1),
        staleTime: "static",
        gcTime: Duration.infinity,
      });
      yield* client.fetchQuery(big);
      // not JSON-serialisable: falls back to a readable hash
      const cyclic: { self?: unknown } = {};
      cyclic.self = cyclic;
      yield* client.fetchQuery(
        Query.single({ key: ["cyclic", cyclic, 2n], run: Effect.succeed(2) }),
      );
      const pending = Query.single({ key: ["never"], run: Effect.never });
      QueryObserver.make(client, pending).subscribe(() => {});
      yield* settle;

      const snapshots = QueryInspector.queries(client);
      const b = snapshots.find((q) => q.key[0] === "big")!;
      assert.strictEqual(b.hash, '["big",{"~bigint":"10"}]');
      assert.strictEqual(b.staleTime, "static");
      assert.strictEqual(b.gcTime, Number.POSITIVE_INFINITY);
      assert.isFalse(Option.isSome(b.dataUpdatedAt)); // TestClock starts at 0
      assert.strictEqual(
        snapshots.find((q) => q.key[0] === "cyclic")!.hash,
        "[cyclic,[object Object],2n]",
      );
      const p = snapshots.find((q) => q.hash === '["never"]')!;
      assert.deepInclude(p, { status: "pending", fetchStatus: "fetching", isActive: true });
      assert.strictEqual(p.observers, 1);
    }),
  );

  it.effect("reset and cancel actions; run forks on the client's runtime", () =>
    Effect.gen(function* () {
      const { client } = yield* setup();
      let n = 0;
      const q = Query.single({
        key: ["r"],
        run: Effect.sync(() => ++n).pipe(Effect.delay("1 second")),
      });
      QueryInspector.run(client, client.prefetchQuery(q));
      yield* settle;
      assert.strictEqual(QueryInspector.queries(client)[0]!.fetchStatus, "fetching");
      yield* QueryInspector.action(client, ["r"], "cancel");
      assert.deepInclude(QueryInspector.queries(client)[0], {
        status: "pending",
        fetchStatus: "idle",
      });

      yield* client.setQueryData(q, 5);
      assert.deepStrictEqual(QueryInspector.queries(client)[0]!.data, Option.some(5));
      yield* QueryInspector.action(client, ["r"], "reset");
      assert.deepInclude(QueryInspector.queries(client)[0], { status: "pending" });
      assert.deepStrictEqual(QueryInspector.queries(client)[0]!.data, Option.none());
      yield* TestClock.adjust("1 second");
      assert.strictEqual(n, 0); // cancelled fetch never completed; reset of an inactive query does not refetch
    }),
  );
});
