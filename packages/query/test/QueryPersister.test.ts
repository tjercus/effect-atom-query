import { assert, describe, expect, it } from "@effect/vitest";
import { DateTime, Effect, Exit, Layer, Option, Schema, Scope } from "effect";
import { KeyValueStore } from "effect/persistence";
import { AtomRegistry } from "effect/reactivity";
import { TestClock } from "effect/testing";
import {
  FocusManager,
  InfiniteQuery,
  Mutation,
  OnlineManager,
  Query,
  QueryClient,
  QueryPersister,
} from "../src/index.ts";
import { counter, settle } from "./utils.ts";

const Todo = Schema.Struct({ title: Schema.String, due: Schema.Option(Schema.DateTimeUtc) });

/** A client + registry + persister sharing the store in context. */
const persistedClient = (
  options?: QueryPersister.Options,
  online = OnlineManager.make({ setup: () => () => {} }),
): Effect.Effect<
  { client: QueryClient.Service; registry: AtomRegistry.AtomRegistry; close: Effect.Effect<void> },
  never,
  KeyValueStore.KeyValueStore | Scope.Scope
> =>
  Effect.gen(function* () {
    const scope = yield* Effect.scope;
    const child = yield* Scope.fork(scope);
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

const todosQuery = (runs: ReturnType<typeof counter>) =>
  Query.single({
    key: ["todos", { page: 1 }],
    run: runs.tick.pipe(
      Effect.map((n) => [
        { title: `todo ${n}`, due: Option.some(DateTime.makeUnsafe(Date.UTC(2026, 10, 13))) },
      ]),
    ),
    staleTime: "1 hour",
    persist: { schema: Schema.Array(Todo) },
  });

describe("QueryPersister", () => {
  it.effect("round-trips persisted queries through storage, typed by their schema", () =>
    Effect.gen(function* () {
      const first = counter();
      const a = yield* persistedClient();
      a.registry.mount(todosQuery(first));
      a.registry.mount(Query.single({ key: ["not-persisted"], run: Effect.succeed(1) }));
      yield* settle;
      yield* TestClock.adjust("1 second"); // throttle
      yield* settle;
      const store = yield* KeyValueStore.KeyValueStore;
      const raw = Option.getOrThrow(Option.fromNullishOr(yield* store.get("effect-native-query")));
      expect(JSON.parse(raw).queries).toHaveLength(1);

      const second = counter();
      const b = yield* persistedClient();
      const q = todosQuery(second);
      b.registry.mount(q);
      const r = b.registry.get(q);
      assert(r.isSuccess);
      expect(r.data.value[0]!.title).toBe("todo 1");
      expect(DateTime.isDateTime(Option.getOrThrow(r.data.value[0]!.due))).toBe(true); // decoded, not JSON
      expect(r.isFetching).toBe(false); // fresh: restored dataUpdatedAt + staleTime
      yield* settle;
      expect(second.count).toBe(0);
    }).pipe(Effect.provide(KeyValueStore.layerMemory)),
  );

  it.effect("discards snapshots with another buster or older than maxAge", () =>
    Effect.gen(function* () {
      const store = yield* KeyValueStore.KeyValueStore;
      const a = yield* persistedClient({ buster: "v1" });
      a.registry.mount(todosQuery(counter()));
      yield* settle;
      yield* a.close; // final write
      expect(yield* store.has("effect-native-query")).toBe(true);

      yield* persistedClient({ buster: "v2" });
      expect(yield* store.has("effect-native-query")).toBe(false);

      const c = yield* persistedClient({ buster: "v1", maxAge: "1 hour" });
      c.registry.mount(todosQuery(counter()));
      yield* settle;
      yield* c.close;
      yield* TestClock.adjust("2 hours");
      const runs = counter();
      const d = yield* persistedClient({ buster: "v1", maxAge: "1 hour" });
      d.registry.mount(todosQuery(runs));
      yield* settle;
      expect(runs.count).toBe(1); // nothing restored: fetched
    }).pipe(Effect.provide(KeyValueStore.layerMemory)),
  );

  it.effect("drops data that no longer decodes and refetches", () =>
    Effect.gen(function* () {
      const store = yield* KeyValueStore.KeyValueStore;
      const a = yield* persistedClient();
      a.registry.mount(todosQuery(counter()));
      yield* settle;
      yield* a.close;
      const raw = JSON.parse((yield* store.get("effect-native-query"))!);
      raw.queries[0].data = [{ title: 42 }];
      yield* store.set("effect-native-query", JSON.stringify(raw));
      const runs = counter();
      const b = yield* persistedClient();
      b.registry.mount(todosQuery(runs));
      yield* settle;
      expect(runs.count).toBe(1);
    }).pipe(Effect.provide(KeyValueStore.layerMemory)),
  );

  it.effect("background restore holds mount fetches until restored", () =>
    Effect.gen(function* () {
      const a = yield* persistedClient();
      a.registry.mount(todosQuery(counter()));
      yield* settle;
      yield* a.close;

      const runs = counter();
      const b = yield* persistedClient({ restore: "background" });
      const restoringAtStart = yield* b.client.isRestoring;
      const q = todosQuery(runs);
      b.registry.mount(q);
      yield* settle;
      expect(yield* b.client.isRestoring).toBe(false);
      expect(restoringAtStart).toBe(true);
      expect(b.registry.get(q).data.pipe(Option.map((t) => t[0]!.title))).toEqual(
        Option.some("todo 1"),
      );
      expect(runs.count).toBe(0);
    }).pipe(Effect.provide(KeyValueStore.layerMemory)),
  );

  it.effect("persists paused offline mutations and resumes them after a reload", () =>
    Effect.gen(function* () {
      const saved: Array<string> = [];
      const addTodo = Mutation.make({
        key: ["todos", "add"],
        run: (title: string) => Effect.sync(() => saved.push(title)),
        persist: { variables: Schema.String },
      });
      const offline = OnlineManager.make({ setup: () => () => {}, initialOnline: false });
      const a = yield* persistedClient({ mutations: [addTodo] }, offline);
      a.registry.mount(addTodo);
      a.registry.set(addTodo, "written offline");
      yield* settle;
      expect(a.registry.get(addTodo)).toMatchObject({ status: "pending", isPaused: true });
      yield* a.close;
      expect(saved).toEqual([]);

      const b = yield* persistedClient({ mutations: [addTodo] });
      yield* settle;
      expect(saved).toEqual(["written offline"]);
      expect(yield* b.client.isMutating()).toBe(0);
    }).pipe(Effect.provide(KeyValueStore.layerMemory)),
  );

  it.effect("persists infinite queries with page schemas", () =>
    Effect.gen(function* () {
      const feed = InfiniteQuery.make({
        key: () => ["feed"],
        run: (_: void, cursor: number) => Effect.succeed({ items: [cursor] }),
        initialPageParam: 0,
        getNextPageParam: (_last, _all, cursor) => Option.some(cursor + 1),
        staleTime: "1 hour",
        persist: {
          page: Schema.Struct({ items: Schema.Array(Schema.Number) }),
          pageParam: Schema.Number,
        },
      });
      const a = yield* persistedClient();
      a.registry.mount(feed());
      yield* settle;
      a.registry.set(feed(), "next");
      yield* settle;
      yield* a.close;
      const b = yield* persistedClient();
      b.registry.mount(feed());
      const r = b.registry.get(feed());
      assert(r.isSuccess);
      expect(r.data.value).toEqual({ pages: [{ items: [0] }, { items: [1] }], pageParams: [0, 1] });
    }).pipe(Effect.provide(KeyValueStore.layerMemory)),
  );
});
