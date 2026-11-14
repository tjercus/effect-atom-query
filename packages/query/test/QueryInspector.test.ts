import { describe, expect, it } from "@effect/vitest";
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
      expect(t.status).toBe("success");
      expect(t.data).toEqual(Option.some(["a"]));
      expect(t.isStale).toBe(false);
      expect(t.staleTime).toBe(60_000);
      expect(t.observers).toBe(0);
      const b = queries.find((q) => q.hash === '["broken"]')!;
      expect(b.status).toBe("error");
      expect(Option.getOrThrow(b.error)).toContain("nope");

      const [m] = QueryInspector.mutations(client);
      expect(m!.status).toBe("success");
      expect(m!.variables).toEqual(Option.some("b"));
      expect(m!.key).toEqual(Option.some(["add"]));
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
      expect(notified).toBeGreaterThan(0);

      yield* QueryInspector.action(client, ["n"], "invalidate");
      expect(QueryInspector.queries(client)[0]!.isInvalidated).toBe(true);
      yield* QueryInspector.action(client, ["n"], "refetch");
      expect(QueryInspector.queries(client)[0]!.data).toEqual(Option.some(2));
      yield* QueryInspector.action(client, ["n"], "remove");
      expect(QueryInspector.queries(client)).toHaveLength(0);
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
      expect(b.hash).toBe('["big",{"~bigint":"10"}]');
      expect(b.staleTime).toBe("static");
      expect(b.gcTime).toBe(Number.POSITIVE_INFINITY);
      expect(Option.isSome(b.dataUpdatedAt)).toBe(false); // TestClock starts at 0
      expect(snapshots.find((q) => q.key[0] === "cyclic")!.hash).toBe(
        "[cyclic,[object Object],2n]",
      );
      const p = snapshots.find((q) => q.hash === '["never"]')!;
      expect(p).toMatchObject({ status: "pending", fetchStatus: "fetching", isActive: true });
      expect(p.observers).toBe(1);
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
      expect(QueryInspector.queries(client)[0]!.fetchStatus).toBe("fetching");
      yield* QueryInspector.action(client, ["r"], "cancel");
      expect(QueryInspector.queries(client)[0]).toMatchObject({
        status: "pending",
        fetchStatus: "idle",
      });

      yield* client.setQueryData(q, 5);
      expect(QueryInspector.queries(client)[0]!.data).toEqual(Option.some(5));
      yield* QueryInspector.action(client, ["r"], "reset");
      expect(QueryInspector.queries(client)[0]).toMatchObject({ status: "pending" });
      expect(QueryInspector.queries(client)[0]!.data).toEqual(Option.none());
      yield* TestClock.adjust("1 second");
      expect(n).toBe(0); // cancelled fetch never completed; reset of an inactive query does not refetch
    }),
  );
});
