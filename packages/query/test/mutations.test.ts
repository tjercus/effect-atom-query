import { assert, describe, expect, it } from "@effect/vitest";
import { Cause, Effect, Fiber, Option, Schema } from "effect";
import { Atom, Reactivity } from "effect/reactivity";
import { TestClock } from "effect/testing";
import { Mutation, MutationObserver, Query, QueryClient } from "../src/index.ts";
import { counter, settle, setup } from "./utils.ts";

class Rejected extends Schema.TaggedError<Rejected>()("Rejected", { title: Schema.String }) {}

/** An in-memory "server" with a todo list. */
const makeServer = () => {
  let todos: ReadonlyArray<string> = ["a"];
  let fetches = 0;
  return {
    get fetches() {
      return fetches;
    },
    todosQuery: Query.single({
      key: ["todos"],
      run: Effect.sync(() => {
        fetches++;
        return todos;
      }).pipe(Effect.delay("100 millis")),
    }),
    add: (title: string) =>
      Effect.suspend(() => {
        if (title === "bad") return Effect.fail(new Rejected({ title }));
        todos = [...todos, title];
        return Effect.succeed(title);
      }).pipe(Effect.delay("100 millis")),
  };
};

describe("mutations", () => {
  it.effect("run through the client and through the atom; Reset clears the atom", () =>
    Effect.gen(function* () {
      const { client, registry } = yield* setup();
      const double = Mutation.make({
        run: (n: number) => Effect.succeed(n * 2).pipe(Effect.delay("1 second")),
      });

      const fiber = yield* Effect.forkChild(client.mutate(double, 21));
      yield* settle;
      expect(yield* client.isMutating()).toBe(1);
      yield* TestClock.adjust("1 second");
      expect(yield* Fiber.join(fiber)).toBe(42);

      registry.mount(double);
      expect(registry.get(double).status).toBe("idle");
      registry.set(double, 5);
      expect(registry.get(double)).toMatchObject({ status: "pending", variables: Option.some(5) });
      yield* TestClock.adjust("1 second");
      yield* settle;
      const r = registry.get(double);
      assert(r.isSuccess);
      expect(r.data.value).toBe(10);
      registry.set(double, Atom.Reset);
      expect(registry.get(double).isIdle).toBe(true);
    }),
  );

  it.effect("run callbacks in order with the onMutate context and the QueryClient available", () =>
    Effect.gen(function* () {
      const { client } = yield* setup();
      const log: Array<string> = [];
      const m = Mutation.make({
        run: (x: string) =>
          x === "fail" ? Effect.fail("boom" as const) : Effect.succeed(x.toUpperCase()),
        onMutate: (x) =>
          Effect.gen(function* () {
            yield* QueryClient.QueryClient; // available in callbacks
            log.push(`mutate ${x}`);
            return `ctx-${x}`;
          }),
        onSuccess: (data, x, ctx) =>
          Effect.sync(() => log.push(`success ${data} ${x} ${Option.getOrThrow(ctx)}`)),
        onError: (cause, x, ctx) =>
          Effect.sync(() =>
            log.push(
              `error ${String(Cause.squash(cause) as string)} ${x} ${Option.getOrThrow(ctx)}`,
            ),
          ),
        onSettled: (exit, x) => Effect.sync(() => log.push(`settled ${exit._tag} ${x}`)),
      });
      yield* client.mutate(m, "ok");
      yield* client.mutate(m, "fail").pipe(Effect.ignore);
      expect(log).toEqual([
        "mutate ok",
        "success OK ok ctx-ok",
        "settled Success ok",
        "mutate fail",
        "error boom fail ctx-fail",
        "settled Failure fail",
      ]);
    }),
  );

  it.effect("invalidates queries and stays pending until active ones have refetched", () =>
    Effect.gen(function* () {
      const { client, registry } = yield* setup();
      const server = makeServer();
      const add = Mutation.make({ run: server.add, invalidates: [["todos"]] });
      registry.mount(server.todosQuery);
      yield* TestClock.adjust("100 millis");
      yield* settle;

      registry.mount(add);
      registry.set(add, "b");
      yield* TestClock.adjust("100 millis"); // mutation done, refetch started
      yield* settle;
      expect(registry.get(add).status).toBe("pending");
      expect(registry.get(server.todosQuery).isFetching).toBe(true);
      yield* TestClock.adjust("100 millis");
      yield* settle;
      expect(registry.get(add).status).toBe("success");
      expect(registry.get(server.todosQuery).data).toEqual(Option.some(["a", "b"]));
      expect(yield* client.getQueryData(server.todosQuery)).toEqual(Option.some(["a", "b"]));
    }),
  );

  it.effect("optimistic update via the cache, rolled back on error", () =>
    Effect.gen(function* () {
      const { client, registry } = yield* setup();
      const server = makeServer();
      const todos = server.todosQuery;
      const add = Mutation.make({
        run: server.add,
        onMutate: (title: string) =>
          Effect.gen(function* () {
            const qc = yield* QueryClient.QueryClient;
            yield* qc.cancelQueries({ queryKey: ["todos"] });
            const previous = yield* qc.getQueryData(todos);
            yield* qc.setQueryData(todos, (current) =>
              Option.map(current, (list) => [...list, title]),
            );
            return previous;
          }),
        onError: (_cause, _title, previous) =>
          Effect.flatMap(QueryClient.QueryClient, (qc) =>
            qc.setQueryData(todos, () => Option.flatten(previous)),
          ),
      });
      registry.mount(todos);
      yield* TestClock.adjust("100 millis");
      yield* settle;

      const fiber = yield* Effect.forkChild(client.mutate(add, "bad"));
      yield* settle;
      expect(registry.get(todos).data).toEqual(Option.some(["a", "bad"])); // optimistic
      yield* TestClock.adjust("100 millis");
      const exit = yield* Fiber.await(fiber);
      expect(exit._tag).toBe("Failure");
      yield* settle;
      expect(registry.get(todos).data).toEqual(Option.some(["a"])); // rolled back
    }),
  );

  it.effect("Mutation.optimisticUpdate writes to the cache and rolls back on error", () =>
    Effect.gen(function* () {
      const { client, registry } = yield* setup();
      const server = makeServer();
      const todos = server.todosQuery;
      const add = Mutation.make({
        run: server.add,
        ...Mutation.optimisticUpdate(todos, (list, title: string) => [...list, title]),
      });
      registry.mount(todos);
      yield* TestClock.adjust("100 millis");
      yield* settle;

      const bad = yield* Effect.forkChild(client.mutate(add, "bad"));
      yield* settle;
      expect(registry.get(todos).data).toEqual(Option.some(["a", "bad"])); // optimistic
      yield* TestClock.adjust("100 millis");
      yield* settle;
      expect(registry.get(todos).data).toEqual(Option.some(["a"])); // rolled back
      expect(registry.get(todos).isFetching).toBe(true); // and refetching
      yield* TestClock.adjust("100 millis");
      expect((yield* Fiber.await(bad))._tag).toBe("Failure");
      yield* settle;

      const good = yield* Effect.forkChild(client.mutate(add, "b"));
      yield* settle;
      expect(registry.get(todos).data).toEqual(Option.some(["a", "b"]));
      yield* TestClock.adjust("100 millis");
      expect((yield* Fiber.await(good))._tag).toBe("Success");
      yield* settle;
      expect(registry.get(todos).data).toEqual(Option.some(["a", "b"])); // kept
    }),
  );

  it.effect("Mutation.optimisticUpdate refetches after overlapping rollbacks", () =>
    Effect.gen(function* () {
      const { client, registry } = yield* setup();
      const server = makeServer();
      const todos = server.todosQuery;
      const add = Mutation.make({
        run: server.add,
        ...Mutation.optimisticUpdate(todos, (list, title: string) => [...list, title]),
      });
      registry.mount(todos);
      yield* TestClock.adjust("100 millis");
      yield* settle;

      // A snapshots [a]; B snapshots A's update [a, bad]. Both fail; B's
      // rollback alone would bring back A's failed item.
      const a = yield* Effect.forkChild(client.mutate(add, "bad"));
      yield* settle;
      const b = yield* Effect.forkChild(client.mutate(add, "bad"));
      yield* settle;
      expect(registry.get(todos).data).toEqual(Option.some(["a", "bad", "bad"]));
      yield* TestClock.adjust("100 millis"); // both fail
      yield* settle;
      yield* TestClock.adjust("100 millis"); // the invalidation refetch lands
      yield* settle;
      yield* Fiber.await(a);
      yield* Fiber.await(b);
      expect(registry.get(todos).data).toEqual(Option.some(["a"]));
    }),
  );

  it.effect("Mutation.optimisticUpdate cancels running fetches and targets family members", () =>
    Effect.gen(function* () {
      const { client, registry } = yield* setup();
      let title = "server";
      const todoQuery = Query.make({
        key: (id: string) => ["todo", id],
        run: (id: string) => Effect.sync(() => `${id}:${title}`).pipe(Effect.delay("100 millis")),
      });
      const rename = Mutation.make({
        run: (input: { readonly id: string; readonly title: string }) =>
          Effect.sync(() => {
            title = input.title;
          }).pipe(Effect.delay("100 millis")),
        ...Mutation.optimisticUpdate(
          (input: { readonly id: string; readonly title: string }) => todoQuery(input.id),
          (_old, input) => `${input.id}:${input.title}`,
        ),
      });
      registry.mount(todoQuery("1"));
      registry.mount(todoQuery("2"));
      yield* TestClock.adjust("100 millis");
      yield* settle;

      // a refetch started before the mutation must not overwrite the update
      yield* Effect.forkChild(client.refetchQueries({ queryKey: ["todo", "1"] }));
      yield* settle;
      yield* Effect.forkChild(client.mutate(rename, { id: "1", title: "renamed" }));
      yield* settle;
      expect(registry.get(todoQuery("1")).data).toEqual(Option.some("1:renamed"));
      yield* TestClock.adjust("100 millis");
      yield* settle;
      expect(registry.get(todoQuery("1")).data).toEqual(Option.some("1:renamed"));
      expect(registry.get(todoQuery("2")).data).toEqual(Option.some("2:server")); // untouched
    }),
  );

  it.effect("Mutation.optimisticUpdate does nothing while the query has no data", () =>
    Effect.gen(function* () {
      const { client, registry } = yield* setup();
      const server = makeServer();
      const add = Mutation.make({
        run: server.add,
        ...Mutation.optimisticUpdate(server.todosQuery, (list, title: string) => [...list, title]),
      });
      const fiber = yield* Effect.forkChild(client.mutate(add, "bad"));
      yield* settle;
      expect(Option.isNone(yield* client.getQueryData(server.todosQuery))).toBe(true);
      yield* TestClock.adjust("100 millis");
      yield* Fiber.await(fiber);
      yield* settle;
      expect(Option.isNone(yield* client.getQueryData(server.todosQuery))).toBe(true);
      expect(registry.get(server.todosQuery).isPending).toBe(true);
    }),
  );

  it.effect("optimistic update via the UI with Mutation.optimistic", () =>
    Effect.gen(function* () {
      const { registry } = yield* setup();
      const server = makeServer();
      const add = Mutation.make({ run: server.add, invalidates: [["todos"]] });
      const view = Mutation.optimistic(server.todosQuery, add, (list, title) => [
        ...list,
        `${title}…`,
      ]);
      registry.mount(view);
      yield* TestClock.adjust("100 millis");
      yield* settle;
      registry.mount(add);
      const seen: Array<ReadonlyArray<string>> = [];
      registry.subscribe(view, (r) => {
        if (Option.isSome(r.data)) seen.push(r.data.value);
      });
      registry.set(add, "b");
      yield* settle;
      expect(registry.get(view).data).toEqual(Option.some(["a", "b…"]));
      yield* TestClock.adjust("200 millis"); // mutation + invalidation refetch
      yield* settle;
      expect(registry.get(view).data).toEqual(Option.some(["a", "b"]));
      // The overlay hands over to the refetched list without showing both.
      expect(seen.filter((list) => list.includes("b") && list.includes("b…"))).toEqual([]);
    }),
  );

  it.effect("serialise executions that share a scope", () =>
    Effect.gen(function* () {
      const { client } = yield* setup();
      const order: Array<string> = [];
      const save = Mutation.make({
        scope: "doc",
        run: (id: string) =>
          Effect.sync(() => order.push(`start ${id}`)).pipe(
            Effect.andThen(Effect.sleep("1 second")),
            Effect.andThen(Effect.sync(() => order.push(`end ${id}`))),
          ),
      });
      const a = MutationObserver.make(client, save);
      const b = MutationObserver.make(client, save);
      a.mutate("a");
      b.mutate("b");
      yield* settle;
      expect(b.getCurrentResult()).toMatchObject({ status: "pending", isPaused: true });
      yield* TestClock.adjust("1 second");
      yield* settle;
      expect(b.getCurrentResult()).toMatchObject({ status: "pending", isPaused: false });
      yield* TestClock.adjust("1 second");
      yield* settle;
      expect(order).toEqual(["start a", "end a", "start b", "end b"]);
    }),
  );

  it.effect("do not retry by default; retry when asked; pause while offline", () =>
    Effect.gen(function* () {
      const { client, online } = yield* setup();
      const runs = counter();
      const flaky = (retry?: number) =>
        Mutation.make({ run: () => runs.tick.pipe(Effect.andThen(Effect.fail("x"))), retry });
      yield* client.mutate(flaky(), undefined).pipe(Effect.ignore);
      expect(runs.count).toBe(1);
      const fiber = yield* Effect.forkChild(client.mutate(flaky(2), undefined).pipe(Effect.ignore));
      yield* TestClock.adjust("10 seconds");
      yield* Fiber.join(fiber);
      expect(runs.count).toBe(4);

      online.setOnline(false);
      const offline = MutationObserver.make(client, Mutation.make({ run: () => runs.tick }));
      offline.mutate();
      yield* settle;
      expect(offline.getCurrentResult()).toMatchObject({ status: "pending", isPaused: true });
      online.setOnline(true);
      yield* settle;
      expect(offline.getCurrentResult().status).toBe("success");
    }),
  );

  it.effect("observer UI callbacks run only for the latest execution", () =>
    Effect.gen(function* () {
      const { client } = yield* setup();
      const seen: Array<number> = [];
      const m = Mutation.make({
        run: (n: number) =>
          Effect.succeed(n).pipe(Effect.delay(n === 1 ? "2 seconds" : "1 second")),
      });
      const observer = MutationObserver.make(client, m, { onSuccess: (n) => seen.push(n) });
      observer.subscribe(() => {});
      observer.mutate(1);
      observer.mutate(2);
      yield* TestClock.adjust("2 seconds");
      yield* settle;
      expect(seen).toEqual([2]);
    }),
  );

  it.effect("observer onError receives the typed failure, None for defects", () =>
    Effect.gen(function* () {
      const { client } = yield* setup();
      const seen: Array<Option.Option<Rejected>> = [];
      const m = Mutation.make({
        run: (title: string) =>
          title === "boom" ? Effect.die("boom") : Effect.fail(new Rejected({ title })),
      });
      const observer = MutationObserver.make(client, m);
      observer.subscribe(() => {});
      observer.mutate("bad", { onError: (_cause, _input, error) => seen.push(error) });
      yield* settle;
      observer.mutate("boom", { onError: (_cause, _input, error) => seen.push(error) });
      yield* settle;
      expect(seen).toEqual([Option.some(new Rejected({ title: "bad" })), Option.none()]);
    }),
  );

  it.effect("settled executions are garbage collected after gcTime", () =>
    Effect.gen(function* () {
      const { client } = yield* setup();
      const m = Mutation.make({ key: ["gc"], run: () => Effect.void });
      yield* client.mutate(m, undefined);
      expect(client.mutationCache.findAll({ mutationKey: ["gc"] })).toHaveLength(1);
      yield* TestClock.adjust("5 minutes");
      yield* settle;
      expect(client.mutationCache.findAll({ mutationKey: ["gc"] })).toHaveLength(0);
    }),
  );

  it.effect("setMutationDefaults applies to matching keys", () =>
    Effect.gen(function* () {
      const { client } = yield* setup();
      const runs = counter();
      yield* client.setMutationDefaults(["todos"], { retry: 1 });
      const m = Mutation.make({
        key: ["todos", "add"],
        run: () => runs.tick.pipe(Effect.andThen(Effect.fail("x"))),
      });
      const fiber = yield* Effect.forkChild(client.mutate(m, undefined).pipe(Effect.ignore));
      yield* TestClock.adjust("5 seconds");
      yield* Fiber.join(fiber);
      expect(runs.count).toBe(2);
    }),
  );
});

describe("cache writes and invalidation", () => {
  it.effect("setQueryData updates subscribers, supports updaters and no-op None", () =>
    Effect.gen(function* () {
      const { client, registry } = yield* setup();
      const q = Query.single({ key: ["counter"], run: Effect.succeed(0), staleTime: "1 minute" });
      registry.mount(q);
      yield* settle;
      expect(yield* client.setQueryData(q, 5)).toEqual(Option.some(5));
      expect(registry.get(q).data).toEqual(Option.some(5));
      yield* client.setQueryData(q, (n) => Option.map(n, (x) => x + 1));
      yield* client.setQueryData(q, () => Option.none());
      expect(registry.get(q).data).toEqual(Option.some(6));
      expect(registry.get(q).isStale).toBe(false);

      // A key without a definition gets an entry too.
      yield* client.setQueryData(["orphan", 1] as const, "x");
      expect(yield* client.getQueryData(["orphan", 1])).toEqual(Option.some("x"));
      expect(yield* client.getQueriesData({ queryKey: ["orphan"] })).toEqual([
        [["orphan", 1], Option.some("x")],
      ]);
      const updated = yield* client.setQueriesData<string>({ queryKey: ["orphan"] }, (s) =>
        Option.map(s, (v) => v + "!"),
      );
      expect(updated).toEqual([[["orphan", 1], Option.some("x!")]]);
    }),
  );

  it.effect(
    "invalidateQueries refetches active queries only, unless refetchType says otherwise",
    () =>
      Effect.gen(function* () {
        const { client, registry } = yield* setup();
        const active = counter();
        const inactive = counter();
        const fixed = counter();
        const qa = Query.single({ key: ["inv", "active"], run: active.tick, staleTime: "1 hour" });
        const qi = Query.single({
          key: ["inv", "inactive"],
          run: inactive.tick,
          staleTime: "1 hour",
        });
        const qs = Query.single({ key: ["inv", "static"], run: fixed.tick, staleTime: "static" });
        registry.mount(qa);
        registry.mount(qs);
        yield* client.fetchQuery(qi);
        yield* settle;

        yield* client.invalidateQueries({ queryKey: ["inv"] });
        expect([active.count, inactive.count, fixed.count]).toEqual([2, 1, 1]);
        expect(Option.getOrThrow(yield* client.getQueryState(qi)).isStale).toBe(true);

        yield* client.invalidateQueries({ queryKey: ["inv"] }, { refetchType: "all" });
        expect([active.count, inactive.count, fixed.count]).toEqual([3, 2, 1]);
      }),
  );

  it.effect("resetQueries restores initial data and refetches active queries", () =>
    Effect.gen(function* () {
      const { client, registry } = yield* setup();
      const runs = counter();
      const q = Query.single({
        key: ["reset"],
        run: runs.tick.pipe(Effect.delay("1 second")),
        initialData: () => 0,
        staleTime: "1 hour",
      });
      registry.mount(q);
      yield* client.setQueryData(q, 99);
      const reset = yield* Effect.forkChild(client.resetQueries({ queryKey: ["reset"] }));
      yield* settle;
      expect(registry.get(q)).toMatchObject({ data: Option.some(0), isFetching: true });
      yield* TestClock.adjust("1 second");
      yield* Fiber.join(reset);
      expect(registry.get(q).data).toEqual(Option.some(1));
    }),
  );

  it.effect("setQueryDefaults applies to matching keys", () =>
    Effect.gen(function* () {
      const { client, registry } = yield* setup();
      yield* client.setQueryDefaults(["slow"], { staleTime: "1 hour" });
      const runs = counter();
      const q = Query.single({ key: ["slow", 1], run: runs.tick });
      registry.mount(q)();
      yield* settle;
      registry.mount(q);
      yield* settle;
      expect(runs.count).toBe(1);
      expect(yield* client.getQueryDefaults(["slow", 1])).toMatchObject({ staleTime: "1 hour" });
    }),
  );

  it.effect("bridges Effect's Reactivity service both ways", () =>
    Effect.gen(function* () {
      const runs = counter();
      const result = yield* Effect.gen(function* () {
        const { registry } = yield* setup();
        const q = Query.single({
          key: ["reactive"],
          run: runs.tick,
          staleTime: "1 hour",
          reactivityKeys: ["todos"],
        });
        registry.mount(q);
        yield* settle;
        yield* Reactivity.invalidate(["todos"]); // e.g. from an AtomHttpApi mutation
        yield* settle;
        const afterExternal = runs.count;

        const { client } = yield* setup();
        const m = Mutation.make({ run: () => Effect.void, reactivityKeys: ["todos"] });
        yield* client.mutate(m, undefined);
        yield* settle;
        return [afterExternal, runs.count];
      }).pipe(Effect.provide(Reactivity.layer));
      expect(result).toEqual([2, 3]);
    }),
  );
});
