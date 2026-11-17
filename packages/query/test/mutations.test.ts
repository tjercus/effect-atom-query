import { assert, describe, it } from "@effect/vitest";
import { Cause, Effect, Fiber, Option, Schema } from "effect";
import { Atom, Reactivity } from "effect/reactivity";
import { TestClock } from "effect/testing";
import { Mutation, MutationObserver, MutationResult, Query, QueryClient } from "../src/index.ts";
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
        if (title === "bad") {
          return Effect.fail(new Rejected({ title }));
        }
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
      assert.strictEqual(yield* client.isMutating(), 1);
      yield* TestClock.adjust("1 second");
      assert.strictEqual(yield* Fiber.join(fiber), 42);

      registry.mount(double);
      assert.strictEqual(registry.get(double).status, "idle");
      registry.set(double, 5);
      const pending = registry.get(double);
      assert.strictEqual(pending.status, "pending");
      assert.deepStrictEqual(pending.variables, Option.some(5));
      yield* TestClock.adjust("1 second");
      yield* settle;
      const r = registry.get(double);
      assert(r.isSuccess);
      assert.strictEqual(r.data.value, 10);
      registry.set(double, Atom.Reset);
      assert.isTrue(registry.get(double).isIdle);
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
      assert.deepStrictEqual(log, [
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
      assert.strictEqual(registry.get(add).status, "pending");
      assert.isTrue(registry.get(server.todosQuery).isFetching);
      yield* TestClock.adjust("100 millis");
      yield* settle;
      assert.strictEqual(registry.get(add).status, "success");
      assert.deepStrictEqual(registry.get(server.todosQuery).data, Option.some(["a", "b"]));
      assert.deepStrictEqual(
        yield* client.getQueryData(server.todosQuery),
        Option.some(["a", "b"]),
      );
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
      assert.deepStrictEqual(registry.get(todos).data, Option.some(["a", "bad"])); // optimistic
      yield* TestClock.adjust("100 millis");
      const exit = yield* Fiber.await(fiber);
      assert.strictEqual(exit._tag, "Failure");
      yield* settle;
      assert.deepStrictEqual(registry.get(todos).data, Option.some(["a"])); // rolled back
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
      assert.deepStrictEqual(registry.get(todos).data, Option.some(["a", "bad"])); // optimistic
      yield* TestClock.adjust("100 millis");
      yield* settle;
      assert.deepStrictEqual(registry.get(todos).data, Option.some(["a"])); // rolled back
      assert.isTrue(registry.get(todos).isFetching); // and refetching
      yield* TestClock.adjust("100 millis");
      assert.strictEqual((yield* Fiber.await(bad))._tag, "Failure");
      yield* settle;

      const good = yield* Effect.forkChild(client.mutate(add, "b"));
      yield* settle;
      assert.deepStrictEqual(registry.get(todos).data, Option.some(["a", "b"]));
      const fetches = server.fetches;
      yield* TestClock.adjust("100 millis"); // saved on the server
      yield* settle;
      assert.isTrue(registry.get(todos).isFetching); // refetching after success too
      yield* TestClock.adjust("100 millis");
      assert.strictEqual((yield* Fiber.await(good))._tag, "Success");
      yield* settle;
      assert.strictEqual(server.fetches, fetches + 1);
      assert.deepStrictEqual(registry.get(todos).data, Option.some(["a", "b"])); // from the server
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
      assert.deepStrictEqual(registry.get(todos).data, Option.some(["a", "bad", "bad"]));
      yield* TestClock.adjust("100 millis"); // both fail
      yield* settle;
      yield* TestClock.adjust("100 millis"); // the invalidation refetch lands
      yield* settle;
      yield* Fiber.await(a);
      yield* Fiber.await(b);
      assert.deepStrictEqual(registry.get(todos).data, Option.some(["a"]));
    }),
  );

  it.effect("Mutation.optimisticUpdate brings back a success rolled back by another failure", () =>
    Effect.gen(function* () {
      const { client, registry } = yield* setup();
      const server = makeServer();
      const todos = server.todosQuery;
      const add = Mutation.make({
        // "slow" is saved on the server only after the other's rollback refetch
        run: (title: string) =>
          server.add(title).pipe(Effect.delay(title === "slow" ? "300 millis" : "0 millis")),
        ...Mutation.optimisticUpdate(todos, (list, title: string) => [...list, title]),
      });
      registry.mount(todos);
      yield* TestClock.adjust("100 millis");
      yield* settle;

      const bad = yield* Effect.forkChild(client.mutate(add, "bad"));
      yield* settle;
      const slow = yield* Effect.forkChild(client.mutate(add, "slow"));
      yield* settle;
      assert.deepStrictEqual(registry.get(todos).data, Option.some(["a", "bad", "slow"]));
      yield* TestClock.adjust("100 millis"); // "bad" fails: rollback to [a]
      yield* settle;
      yield* TestClock.adjust("100 millis"); // its refetch lands, "slow" not saved yet
      yield* settle;
      assert.strictEqual((yield* Fiber.await(bad))._tag, "Failure");
      assert.deepStrictEqual(registry.get(todos).data, Option.some(["a"]));
      yield* TestClock.adjust("200 millis"); // "slow" is saved
      yield* settle;
      yield* TestClock.adjust("100 millis"); // and its refetch lands
      assert.strictEqual((yield* Fiber.await(slow))._tag, "Success");
      yield* settle;
      assert.deepStrictEqual(registry.get(todos).data, Option.some(["a", "slow"]));
    }),
  );

  it.effect("Mutation.optimisticUpdate does not cancel a first load", () =>
    Effect.gen(function* () {
      const { client, registry } = yield* setup();
      const server = makeServer();
      const add = Mutation.make({
        run: server.add,
        ...Mutation.optimisticUpdate(server.todosQuery, (list, title: string) => [...list, title]),
      });
      registry.mount(server.todosQuery);
      yield* settle;
      assert.isTrue(registry.get(server.todosQuery).isLoading);
      const fiber = yield* Effect.forkChild(client.mutate(add, "b"));
      yield* settle;
      assert.isTrue(registry.get(server.todosQuery).isFetching); // still loading
      yield* TestClock.adjust("100 millis");
      yield* Fiber.await(fiber);
      yield* settle;
      const result = registry.get(server.todosQuery);
      assert.isTrue(result.isSuccess);
      assert.strictEqual(server.fetches, 1);
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
      assert.deepStrictEqual(registry.get(todoQuery("1")).data, Option.some("1:renamed"));
      yield* TestClock.adjust("100 millis");
      yield* settle;
      assert.deepStrictEqual(registry.get(todoQuery("1")).data, Option.some("1:renamed"));
      assert.deepStrictEqual(registry.get(todoQuery("2")).data, Option.some("2:server")); // untouched
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
      assert.isTrue(Option.isNone(yield* client.getQueryData(server.todosQuery)));
      yield* TestClock.adjust("100 millis");
      yield* Fiber.await(fiber);
      yield* settle;
      assert.isTrue(Option.isNone(yield* client.getQueryData(server.todosQuery)));
      assert.isTrue(registry.get(server.todosQuery).isPending);
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
        if (Option.isSome(r.data)) {
          seen.push(r.data.value);
        }
      });
      registry.set(add, "b");
      yield* settle;
      assert.deepStrictEqual(registry.get(view).data, Option.some(["a", "b…"]));
      yield* TestClock.adjust("200 millis"); // mutation + invalidation refetch
      yield* settle;
      assert.deepStrictEqual(registry.get(view).data, Option.some(["a", "b"]));
      // The overlay hands over to the refetched list without showing both.
      assert.deepStrictEqual(
        seen.filter((list) => list.includes("b") && list.includes("b…")),
        [],
      );
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
      assert.deepInclude(b.getCurrentResult(), { status: "pending", isPaused: true });
      yield* TestClock.adjust("1 second");
      yield* settle;
      assert.deepInclude(b.getCurrentResult(), { status: "pending", isPaused: false });
      yield* TestClock.adjust("1 second");
      yield* settle;
      assert.deepStrictEqual(order, ["start a", "end a", "start b", "end b"]);
    }),
  );

  it.effect("do not retry by default; retry when asked; pause while offline", () =>
    Effect.gen(function* () {
      const { client, online } = yield* setup();
      const runs = counter();
      const flaky = (retry?: number) =>
        Mutation.make({ run: () => runs.tick.pipe(Effect.andThen(Effect.fail("x"))), retry });
      yield* client.mutate(flaky(), undefined).pipe(Effect.ignore);
      assert.strictEqual(runs.count, 1);
      const fiber = yield* Effect.forkChild(client.mutate(flaky(2), undefined).pipe(Effect.ignore));
      yield* TestClock.adjust("10 seconds");
      yield* Fiber.join(fiber);
      assert.strictEqual(runs.count, 4);

      online.setOnline(false);
      const offline = MutationObserver.make(client, Mutation.make({ run: () => runs.tick }));
      offline.mutate();
      yield* settle;
      assert.deepInclude(offline.getCurrentResult(), { status: "pending", isPaused: true });
      online.setOnline(true);
      yield* settle;
      assert.strictEqual(offline.getCurrentResult().status, "success");
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
      assert.deepStrictEqual(seen, [2]);
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
      assert.deepStrictEqual(seen, [Option.some(new Rejected({ title: "bad" })), Option.none()]);
    }),
  );

  it.effect("settled executions are garbage collected after gcTime", () =>
    Effect.gen(function* () {
      const { client } = yield* setup();
      const m = Mutation.make({ key: ["gc"], run: () => Effect.void });
      yield* client.mutate(m, undefined);
      assert.lengthOf(client.mutationCache.findAll({ mutationKey: ["gc"] }), 1);
      yield* TestClock.adjust("5 minutes");
      yield* settle;
      assert.lengthOf(client.mutationCache.findAll({ mutationKey: ["gc"] }), 0);
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
      assert.strictEqual(runs.count, 2);
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
      assert.deepStrictEqual(yield* client.setQueryData(q, 5), Option.some(5));
      assert.deepStrictEqual(registry.get(q).data, Option.some(5));
      yield* client.setQueryData(q, (n) => Option.map(n, (x) => x + 1));
      yield* client.setQueryData(q, () => Option.none());
      assert.deepStrictEqual(registry.get(q).data, Option.some(6));
      assert.isFalse(registry.get(q).isStale);

      // A key without a definition gets an entry too.
      yield* client.setQueryData(["orphan", 1] as const, "x");
      assert.deepStrictEqual(yield* client.getQueryData(["orphan", 1]), Option.some("x"));
      assert.deepStrictEqual(yield* client.getQueriesData({ queryKey: ["orphan"] }), [
        [["orphan", 1], Option.some("x")],
      ]);
      const updated = yield* client.setQueriesData<string>({ queryKey: ["orphan"] }, (s) =>
        Option.map(s, (v) => v + "!"),
      );
      assert.deepStrictEqual(updated, [[["orphan", 1], Option.some("x!")]]);
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
        assert.deepStrictEqual([active.count, inactive.count, fixed.count], [2, 1, 1]);
        assert.isTrue(Option.getOrThrow(yield* client.getQueryState(qi)).isStale);

        yield* client.invalidateQueries({ queryKey: ["inv"] }, { refetchType: "all" });
        assert.deepStrictEqual([active.count, inactive.count, fixed.count], [3, 2, 1]);
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
      assert.deepInclude(registry.get(q), { data: Option.some(0), isFetching: true });
      yield* TestClock.adjust("1 second");
      yield* Fiber.join(reset);
      assert.deepStrictEqual(registry.get(q).data, Option.some(1));
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
      assert.strictEqual(runs.count, 1);
      assert.deepInclude(yield* client.getQueryDefaults(["slow", 1]), { staleTime: "1 hour" });
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
      assert.deepStrictEqual(result, [2, 3]);
    }),
  );
});

describe("MutationObserver", () => {
  it.effect("setOptions swaps the mutation and the UI callbacks", () =>
    Effect.gen(function* () {
      const { client } = yield* setup();
      const seen: Array<string> = [];
      const double = Mutation.make({ run: (n: number) => Effect.succeed(n * 2) });
      const triple = Mutation.make({ run: (n: number) => Effect.succeed(n * 3) });
      const observer = MutationObserver.make(client, double, {
        onSuccess: (a) => seen.push(`old ${a}`),
      });
      observer.subscribe(() => {});
      observer.setOptions(triple, { onSuccess: (a) => seen.push(`new ${a}`) });
      observer.mutate(2);
      yield* settle;
      assert.deepStrictEqual(seen, ["new 6"]);
      observer.setOptions(double);
      observer.mutate(2);
      yield* settle;
      assert.deepStrictEqual(seen, ["new 6"]); // no callbacks any more
      assert.deepStrictEqual(observer.getCurrentResult().data, Option.some(4));
    }),
  );

  it.effect("subscribing after mutate attaches to the running execution", () =>
    Effect.gen(function* () {
      const { client } = yield* setup();
      const m = Mutation.make({
        run: (n: number) => Effect.succeed(n).pipe(Effect.delay("1 second")),
      });
      const settled: Array<number> = [];
      const observer = MutationObserver.make(client, m, { onSuccess: (n) => settled.push(n) });
      observer.mutate(1);
      yield* settle;
      const pending = observer.getCurrentResult();
      assert.strictEqual(pending.status, "pending");
      assert.strictEqual(observer.getCurrentResult(), pending); // memoised per state

      let notified = 0;
      const unsubscribe = observer.subscribe(() => notified++);
      const entry = client.mutationCache.all()[0]!;
      assert.strictEqual(entry.observers, 1);
      yield* TestClock.adjust("1 second");
      yield* settle;
      assert.isAbove(notified, 0);
      assert.strictEqual(observer.getCurrentResult().status, "success");
      assert.deepStrictEqual(settled, [1]); // subscribed when it settled
      unsubscribe();
      assert.strictEqual(entry.observers, 0);
    }),
  );

  it.effect("mutateEffect runs with the caller's services and returns the result", () =>
    Effect.gen(function* () {
      const { client } = yield* setup();
      const m = Mutation.make({
        run: (n: number) =>
          n > 0 ? Effect.succeed(n + 1) : Effect.fail(new Rejected({ title: String(n) })),
      });
      const observer = MutationObserver.make(client, m);
      assert.strictEqual(yield* observer.mutateEffect(1), 2);
      assert.deepStrictEqual(observer.getCurrentResult().data, Option.some(2));
      const error = yield* Effect.flip(observer.mutateEffect(0));
      assert.deepStrictEqual(error, new Rejected({ title: "0" }));
      assert.strictEqual(observer.getCurrentResult().status, "error");
    }),
  );

  it.effect("reset forgets the latest execution and notifies", () =>
    Effect.gen(function* () {
      const { client } = yield* setup();
      const m = Mutation.make({ run: (n: number) => Effect.succeed(n) });
      const observer = MutationObserver.make(client, m);
      let notified = 0;
      observer.subscribe(() => notified++);
      observer.mutate(7);
      yield* settle;
      assert.strictEqual(observer.getCurrentResult().status, "success");
      const entry = client.mutationCache.all()[0]!;
      const before = notified;
      observer.reset();
      assert.strictEqual(notified, before + 1);
      assert.strictEqual(observer.getCurrentResult().status, "idle");
      assert.strictEqual(entry.observers, 0);
      assert.isFalse(MutationResult.isDefect(observer.getCurrentResult()));
    }),
  );

  it.effect("MutationResult.isDefect tells defects from typed failures", () =>
    Effect.gen(function* () {
      const { client } = yield* setup();
      const m = Mutation.make({
        run: (kind: string) =>
          kind === "die" ? Effect.die("boom") : Effect.fail(new Rejected({ title: kind })),
      });
      const observer = MutationObserver.make(client, m);
      yield* Effect.exit(observer.mutateEffect("die"));
      assert.isTrue(MutationResult.isDefect(observer.getCurrentResult()));
      yield* Effect.exit(observer.mutateEffect("typed"));
      assert.isFalse(MutationResult.isDefect(observer.getCurrentResult()));
    }),
  );
});

describe("Mutation.optimistic with overlapping executions", () => {
  it.effect("applies pending inputs in submission order", () =>
    Effect.gen(function* () {
      const { client, registry } = yield* setup();
      const list = Query.single({
        key: ["overlap"],
        run: Effect.succeed<ReadonlyArray<string>>([]),
      });
      const add = Mutation.make({
        run: (title: string) => Effect.succeed(title).pipe(Effect.delay("1 second")),
      });
      const view = Mutation.optimistic(list, add, (items, title) => [...items, title]);
      registry.mount(view);
      yield* settle;
      const a = MutationObserver.make(client, add);
      const b = MutationObserver.make(client, add);
      a.mutate("first");
      yield* TestClock.adjust("1 millis");
      b.mutate("second");
      yield* settle;
      assert.deepStrictEqual(registry.get(view).data, Option.some(["first", "second"]));
      assert.isTrue(Mutation.isMutationAtom(add));
      assert.isFalse(Mutation.isMutationAtom(list));
      yield* TestClock.adjust("1 second");
      yield* settle;
      assert.deepStrictEqual(registry.get(view).data, Option.some([]));
    }),
  );
});
