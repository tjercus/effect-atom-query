import { describe, expect, it } from "@effect/vitest";
import { Effect, Option } from "effect";
import { Mutation, Query, QueryInspector } from "../src/index.ts";
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
});
