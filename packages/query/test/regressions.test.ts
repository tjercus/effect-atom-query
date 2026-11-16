/**
 * Regression tests for defects found in the pre-release review (2026-11-14).
 */
import { describe, expect, it } from "@effect/vitest";
import { Cause, Effect, Exit, Layer, Option, Schema, Scope } from "effect";
import { KeyValueStore } from "effect/persistence";
import { AtomRegistry } from "effect/reactivity";
import { TestClock } from "effect/testing";
import {
  FocusManager,
  Mutation,
  MutationObserver,
  MutationResult,
  OnlineManager,
  Query,
  QueryClient,
  QueryObserver,
  QueryPersister,
} from "../src/index.ts";
import { counter, settle, setup } from "./utils.ts";

describe("core engine", () => {
  it.effect("bigint keys work (setQueryData, mutations, toJsonKey)", () =>
    Effect.gen(function* () {
      const { client } = yield* setup();
      yield* client.setQueryData(["invoice", 10n], "paid");
      expect(yield* client.getQueryData(["invoice", 10n])).toEqual(Option.some("paid"));
      const pay = Mutation.make({ key: ["pay", 10n], run: (n: number) => Effect.succeed(n) });
      expect(yield* client.mutate(pay, 1)).toBe(1);
    }),
  );

  it.effect("invalidating an active query does not hang while offline", () =>
    Effect.gen(function* () {
      const { client, online } = yield* setup();
      const q = Query.single({ key: ["offline-invalidate"], run: Effect.succeed(1) });
      yield* client.fetchQuery(q);
      const observer = QueryObserver.make(client, q);
      observer.subscribe(() => {});
      yield* settle;
      online.setOnline(false);
      const invalidate = yield* Effect.forkChild(
        client.invalidateQueries({ queryKey: ["offline-invalidate"] }),
      );
      yield* settle;
      expect(invalidate.pollUnsafe()).toBeDefined(); // completed
      expect(client.cache.build(q).state.fetchStatus).toBe("paused");
    }),
  );

  it.effect("a mutation's `invalidates` does not keep it pending while offline", () =>
    Effect.gen(function* () {
      const { client, online } = yield* setup();
      const q = Query.single({ key: ["offline-mut"], run: Effect.succeed(1) });
      yield* client.fetchQuery(q);
      QueryObserver.make(client, q).subscribe(() => {});
      yield* settle;
      const m = Mutation.make({
        run: () => Effect.succeed("ok"),
        networkMode: "always",
        invalidates: [["offline-mut"]],
      });
      online.setOnline(false);
      const mutation = yield* Effect.forkChild(client.mutate(m, undefined));
      yield* settle;
      expect(mutation.pollUnsafe()).toBeDefined(); // settled despite the paused refetch
    }),
  );

  it.effect("closing the client does not re-create observed entries or refetch", () =>
    Effect.gen(function* () {
      const focus = FocusManager.make({ setup: () => () => {}, isFocused: () => true });
      const online = OnlineManager.make({ setup: () => () => {} });
      const scope = yield* Scope.make();
      const runs = counter();
      const client = yield* QueryClient.make().pipe(
        Effect.provideService(FocusManager.FocusManager, focus),
        Effect.provideService(OnlineManager.OnlineManager, online),
        Scope.provide(scope),
      );
      const q = Query.single({ key: ["shutdown"], run: runs.tick });
      QueryObserver.make(client, q).subscribe(() => {});
      yield* settle;
      yield* Scope.close(scope, Exit.void);
      yield* settle;
      expect(client.cache.all()).toHaveLength(0);
      expect(runs.count).toBe(1);
    }),
  );

  it.effect("refetching after a load error shows pending / isLoading, not the old error", () =>
    Effect.gen(function* () {
      const { client } = yield* setup();
      let fail = true;
      const q = Query.single({
        key: ["reload"],
        run: Effect.suspend(() =>
          fail ? Effect.fail("x") : Effect.succeed(1).pipe(Effect.delay("1 second")),
        ),
        retry: false,
      });
      yield* Effect.exit(client.fetchQuery(q));
      fail = false;
      const entry = client.cache.build(q);
      entry.fetch();
      yield* settle;
      const r = entry.toResult();
      expect([r.status, r.isLoading, Option.isNone(r.error)]).toEqual(["pending", true, true]);
      // cancelling reverts to the error
      entry.cancel();
      yield* settle;
      expect(entry.toResult().status).toBe("error");
    }),
  );

  it.effect("ensureQueryData({ revalidateIfStale }) honours its staleTime option", () =>
    Effect.gen(function* () {
      const { client } = yield* setup();
      const runs = counter();
      const q = Query.single({ key: ["ensure-stale"], run: runs.tick });
      yield* client.fetchQuery(q);
      yield* TestClock.adjust("1 second");
      yield* client.ensureQueryData(q, { staleTime: "1 hour", revalidateIfStale: true });
      yield* settle;
      expect(runs.count).toBe(1);
    }),
  );

  it.effect("superseding a fetch does not emit an intermediate idle state", () =>
    Effect.gen(function* () {
      const { client } = yield* setup();
      let n = 0;
      const q = Query.single({
        key: ["supersede"],
        run: Effect.sync(() => ++n).pipe(Effect.delay("1 second")),
      });
      yield* Effect.forkChild(client.fetchQuery(q));
      yield* TestClock.adjust("1 second");
      const entry = client.cache.build(q);
      entry.fetch();
      yield* settle;
      const seen: Array<string> = [];
      entry.subscribe(() => seen.push(entry.state.fetchStatus));
      entry.fetch({ cancelRefetch: true });
      expect(seen).not.toContain("idle");
    }),
  );
});

/** A client + persister in a child scope, closable mid-test (a "reload"). */
const persistedClient = (
  options?: QueryPersister.Options,
  online = OnlineManager.make({ setup: () => () => {} }),
) =>
  Effect.gen(function* () {
    const child = yield* Scope.fork(yield* Effect.scope);
    const client = yield* QueryClient.make().pipe(
      Effect.provideService(
        FocusManager.FocusManager,
        FocusManager.make({ setup: () => () => {} }),
      ),
      Effect.provideService(OnlineManager.OnlineManager, online),
      Effect.provideService(Scope.Scope, child),
    );
    yield* Layer.buildWithScope(QueryPersister.layer(options), child).pipe(
      Effect.provideService(QueryClient.QueryClient, client),
    );
    const registry = AtomRegistry.make({
      initialValues: [QueryClient.initialValue(client)],
      scheduleTask: (f) => {
        queueMicrotask(f);
        return () => {};
      },
    });
    return { client, registry, close: Scope.close(child, Exit.void) };
  });

const persisted = (key: string) =>
  Query.single({
    key: [key],
    run: Effect.succeed(42),
    staleTime: "1 hour",
    persist: { schema: Schema.Number },
  });

describe("persistence", () => {
  it.effect("closing during a background restore does not wipe storage", () =>
    Effect.gen(function* () {
      const a = yield* persistedClient();
      a.registry.mount(persisted("k"));
      yield* settle;
      yield* a.close;
      const store = yield* KeyValueStore.KeyValueStore;
      const before = yield* store.get("effect-atom-query");
      const slow = {
        ...store,
        get: (k: string) => store.get(k).pipe(Effect.delay("50 millis")),
      } as KeyValueStore.KeyValueStore;
      const b = yield* persistedClient({ restore: "background" }).pipe(
        Effect.provideService(KeyValueStore.KeyValueStore, slow),
      );
      yield* b.close;
      expect(yield* store.get("effect-atom-query")).toEqual(before);
    }).pipe(Effect.provide(KeyValueStore.layerMemory)),
  );

  it.effect("client.clear drops restored data no query has claimed yet", () =>
    Effect.gen(function* () {
      const a = yield* persistedClient();
      a.registry.mount(persisted("secret"));
      yield* settle;
      yield* a.close;
      const b = yield* persistedClient();
      yield* b.client.clear;
      yield* b.close;
      const store = yield* KeyValueStore.KeyValueStore;
      expect((yield* store.get("effect-atom-query")) ?? "").not.toContain("secret");
    }).pipe(Effect.provide(KeyValueStore.layerMemory)),
  );

  it.effect("removeQueries drops matching unclaimed restored data", () =>
    Effect.gen(function* () {
      const a = yield* persistedClient();
      a.registry.mount(persisted("keep"));
      a.registry.mount(persisted("drop"));
      yield* settle;
      yield* a.close;
      const b = yield* persistedClient();
      yield* b.client.removeQueries({ queryKey: ["drop"] });
      yield* b.close;
      const stored = (yield* (yield* KeyValueStore.KeyValueStore).get("effect-atom-query")) ?? "";
      expect([stored.includes("keep"), stored.includes("drop")]).toEqual([true, false]);
    }).pipe(Effect.provide(KeyValueStore.layerMemory)),
  );

  it.effect("unclaimed restored data expires after maxAge instead of being renewed", () =>
    Effect.gen(function* () {
      const a = yield* persistedClient({ maxAge: "1 hour" });
      a.registry.mount(persisted("old"));
      yield* settle;
      yield* a.close;
      const b = yield* persistedClient({ maxAge: "1 hour" });
      yield* TestClock.adjust("2 hours");
      yield* b.close;
      const stored = (yield* (yield* KeyValueStore.KeyValueStore).get("effect-atom-query")) ?? "";
      expect(stored).not.toContain("old");
    }).pipe(Effect.provide(KeyValueStore.layerMemory)),
  );

  it.effect("a resumed mutation does not run onMutate again", () =>
    Effect.gen(function* () {
      let onMutates = 0;
      const addTodo = Mutation.make({
        key: ["todos", "add"],
        run: (title: string) => Effect.as(Effect.void, title),
        onMutate: () => Effect.sync(() => void onMutates++),
        persist: { variables: Schema.String },
      });
      const offline = OnlineManager.make({ setup: () => () => {}, initialOnline: false });
      const a = yield* persistedClient({ mutations: [addTodo] }, offline);
      a.registry.mount(addTodo);
      a.registry.set(addTodo, "x");
      yield* settle;
      yield* a.close;
      const b = yield* persistedClient({ mutations: [addTodo] });
      yield* settle;
      expect(onMutates).toBe(1);
      const [resumed] = b.client.mutationCache.all();
      expect(resumed?.state.status).toBe("success");
    }).pipe(Effect.provide(KeyValueStore.layerMemory)),
  );
});

describe("mutations", () => {
  it.effect("setMutationDefaults (by key) win over the client-wide defaults", () =>
    Effect.gen(function* () {
      const { client } = yield* setup({ defaultOptions: { mutations: { retry: false } } });
      let runs = 0;
      yield* client.setMutationDefaults(["m"], { retry: 2 });
      const m = Mutation.make({
        key: ["m"],
        run: () => Effect.sync(() => runs++).pipe(Effect.andThen(Effect.fail("x"))),
      });
      MutationObserver.make(client, m).mutate(undefined);
      yield* settle;
      yield* TestClock.adjust("10 seconds");
      yield* settle;
      expect(runs).toBe(3);
    }),
  );

  it.effect(
    "Mutation.optimistic keeps the overlay over a fetch that started before the write",
    () =>
      Effect.gen(function* () {
        const { registry, client } = yield* setup();
        let todos: ReadonlyArray<string> = ["a"];
        const todosQuery = Query.single({
          key: ["todos-race"],
          run: Effect.sync(() => todos).pipe(Effect.tap(() => Effect.sleep("100 millis"))),
        });
        const add = Mutation.make({
          run: (t: string) =>
            Effect.sync(() => {
              todos = [...todos, t];
            }).pipe(Effect.delay("100 millis")),
          onSuccess: () => Effect.sleep("100 millis"),
          invalidates: [["todos-race"]],
        });
        const view = Mutation.optimistic(todosQuery, add, (list, t) => [...list, `${t}…`]);
        registry.mount(view);
        registry.mount(add);
        yield* TestClock.adjust("100 millis");
        yield* settle;
        registry.set(add, "b"); // t=100; the write lands at t=200
        yield* settle;
        yield* TestClock.adjust("50 millis");
        yield* settle;
        // t=150: a refetch reads ["a"] and lands at t=250, after the write
        yield* Effect.forkChild(client.refetchQueries({ queryKey: ["todos-race"] }));
        yield* settle;
        yield* TestClock.adjust("110 millis");
        yield* settle;
        expect(registry.get(view).data).toEqual(Option.some(["a", "b…"]));
      }),
  );

  it.effect("idle mutation scopes are forgotten", () =>
    Effect.gen(function* () {
      const { client } = yield* setup();
      const save = Mutation.make({
        scope: (id: string) => `doc-${id}`,
        run: (title: string) => Effect.as(Effect.void, title),
      });
      for (const id of ["a", "b", "c"]) yield* client.mutate(save, id);
      expect(
        (client.mutationCache as unknown as { scopes: Map<string, unknown> }).scopes.size,
      ).toBe(0);
    }),
  );
});

/** Regression tests for the review of 2026-11-16 (docs/REVIEW-2026-11-16.md). */
describe("review 2026-11-16", () => {
  it.effect("client.clear in a mutation's own callback does not kill the mutation", () =>
    Effect.gen(function* () {
      const { client } = yield* setup();
      const log: Array<string> = [];
      const logout = Mutation.make({
        run: () => Effect.succeed("bye").pipe(Effect.delay("1 second")),
        onSuccess: () =>
          Effect.gen(function* () {
            const current = yield* QueryClient.QueryClient;
            yield* current.clear;
            log.push("after clear");
          }),
        onSettled: () => Effect.sync(() => log.push("definition onSettled")),
      });
      const observer = MutationObserver.make(client, logout);
      observer.subscribe(() => {});
      observer.mutate(undefined, {
        onSuccess: () => log.push("ui onSuccess"),
        onSettled: () => log.push("ui onSettled"),
      });
      yield* settle;
      yield* TestClock.adjust("1 second");
      yield* settle;
      expect(log).toEqual(["after clear", "definition onSettled", "ui onSuccess", "ui onSettled"]);
      expect(observer.getCurrentResult().status).toBe("success");
      expect(client.mutationCache.all()).toHaveLength(0);

      const viaClient = yield* Effect.forkChild(client.mutate(logout, undefined));
      yield* settle;
      yield* TestClock.adjust("1 second");
      yield* settle;
      expect(viaClient.pollUnsafe()).toEqual(Exit.succeed("bye"));
    }),
  );

  it.effect("closing the client interrupts running mutations", () =>
    Effect.gen(function* () {
      const focus = FocusManager.make({ setup: () => () => {}, isFocused: () => true });
      const online = OnlineManager.make({ setup: () => () => {} });
      const scope = yield* Scope.make();
      const client = yield* QueryClient.make().pipe(
        Effect.provideService(FocusManager.FocusManager, focus),
        Effect.provideService(OnlineManager.OnlineManager, online),
        Scope.provide(scope),
      );
      let finished = false;
      const slow = Mutation.make({
        run: () =>
          Effect.sleep("1 second").pipe(Effect.andThen(Effect.sync(() => (finished = true)))),
      });
      const observer = MutationObserver.make(client, slow);
      observer.subscribe(() => {});
      observer.mutate(undefined);
      yield* settle;
      yield* Scope.close(scope, Exit.void);
      yield* TestClock.adjust("1 second");
      yield* settle;
      expect(finished).toBe(false);
      expect(observer.getCurrentResult().status).toBe("idle");
    }),
  );

  it.effect("fetchQuery follows a fetch that invalidateQueries superseded", () =>
    Effect.gen(function* () {
      const { client } = yield* setup();
      let value = 0;
      const q = Query.single({
        key: ["superseded-fetch"],
        run: Effect.sync(() => ++value).pipe(Effect.delay("1 second")),
      });
      yield* client.setQueryData(q, 0);
      QueryObserver.make(client, q, { refetchOnMount: false }).subscribe(() => {});
      yield* TestClock.adjust("1 second"); // the written data is stale now
      const fetching = yield* Effect.forkChild(client.fetchQuery(q));
      yield* settle;
      yield* Effect.forkChild(client.invalidateQueries({ queryKey: ["superseded-fetch"] }));
      yield* settle;
      yield* TestClock.adjust("1 second");
      yield* settle;
      // the first run was interrupted before it produced a value
      expect(fetching.pollUnsafe()).toEqual(Exit.succeed(1));
    }),
  );

  it.effect("fetchQuery follows a superseding fetch that settles synchronously", () =>
    Effect.gen(function* () {
      const { client } = yield* setup();
      let slow = true;
      const q = Query.single({
        key: ["superseded-sync"],
        run: Effect.suspend(() =>
          slow ? Effect.succeed("slow").pipe(Effect.delay("1 second")) : Effect.succeed("fast"),
        ),
      });
      yield* client.setQueryData(q, "seed");
      yield* TestClock.adjust("1 second");
      const fetching = yield* Effect.forkChild(client.fetchQuery(q));
      yield* settle;
      slow = false;
      yield* client.refetchQueries({ queryKey: ["superseded-sync"] });
      yield* settle;
      expect(fetching.pollUnsafe()).toEqual(Exit.succeed("fast"));
    }),
  );

  it.effect("cancelQueries still interrupts a waiting fetchQuery", () =>
    Effect.gen(function* () {
      const { client } = yield* setup();
      const q = Query.single({
        key: ["cancelled-fetch"],
        run: Effect.succeed(1).pipe(Effect.delay("1 second")),
      });
      const fetching = yield* Effect.forkChild(client.fetchQuery(q));
      yield* settle;
      yield* client.cancelQueries({ queryKey: ["cancelled-fetch"] });
      yield* settle;
      const exit = fetching.pollUnsafe();
      expect(
        exit !== undefined && Exit.isFailure(exit) && Cause.hasInterruptsOnly(exit.cause),
      ).toBe(true);
    }),
  );

  it.effect("an interrupted mutation goes back to idle, not to error (D7)", () =>
    Effect.gen(function* () {
      const { client, registry } = yield* setup();
      const interrupted = Mutation.make({ run: () => Effect.interrupt });
      const calls: Array<string> = [];
      const observer = MutationObserver.make(client, interrupted, {
        onError: () => calls.push("hook onError"),
        onSettled: () => calls.push("hook onSettled"),
      });
      observer.subscribe(() => {});
      observer.mutate(undefined, { onError: () => calls.push("onError") });
      yield* settle;
      const result = observer.getCurrentResult();
      expect(result.status).toBe("idle");
      expect(MutationResult.isDefect(result)).toBe(false);
      expect(calls).toEqual([]);

      registry.mount(interrupted);
      registry.set(interrupted, undefined);
      yield* settle;
      expect(registry.get(interrupted).status).toBe("idle");

      const exit = yield* Effect.exit(client.mutate(interrupted, undefined));
      expect(Exit.isFailure(exit) && Cause.hasInterruptsOnly(exit.cause)).toBe(true);
      // Settled (although idle), so the unobserved execution is collected;
      // the observer's and the mounted atom's stay.
      expect(client.mutationCache.findAll({ mutation: interrupted })).toHaveLength(3);
      yield* TestClock.adjust("5 minutes");
      yield* settle;
      expect(client.mutationCache.findAll({ mutation: interrupted })).toHaveLength(2);
    }),
  );

  it.effect("closing the client does not re-create entries read through the atom", () =>
    Effect.gen(function* () {
      const focus = FocusManager.make({ setup: () => () => {}, isFocused: () => true });
      const online = OnlineManager.make({ setup: () => () => {} });
      const scope = yield* Scope.make();
      const runs = counter();
      const client = yield* QueryClient.make().pipe(
        Effect.provideService(FocusManager.FocusManager, focus),
        Effect.provideService(OnlineManager.OnlineManager, online),
        Scope.provide(scope),
      );
      const registry = AtomRegistry.make({ initialValues: [QueryClient.initialValue(client)] });
      const q = Query.single({ key: ["shutdown-atom"], run: runs.tick });
      registry.mount(q);
      yield* settle;
      yield* Scope.close(scope, Exit.void);
      yield* settle;
      expect(client.cache.all()).toHaveLength(0);
      expect(runs.count).toBe(1);
      expect(registry.get(q).data).toEqual(Option.some(1)); // keeps the last result
      registry.dispose();
    }),
  );
});
