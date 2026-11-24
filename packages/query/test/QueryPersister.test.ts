import { assert, describe, it } from "@effect/vitest";
import { vi } from "vite-plus/test";
import { DateTime, Effect, Exit, Layer, Option, Schema, Scope, Stream } from "effect";
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
      const raw = Option.getOrThrow(Option.fromNullishOr(yield* store.get("effect-atom-query")));
      assert.lengthOf(JSON.parse(raw).queries, 1);

      const second = counter();
      const b = yield* persistedClient();
      const q = todosQuery(second);
      b.registry.mount(q);
      const r = b.registry.get(q);
      assert(r.isSuccess);
      assert.strictEqual(r.data.value[0]!.title, "todo 1");
      assert.isTrue(DateTime.isDateTime(Option.getOrThrow(r.data.value[0]!.due))); // decoded, not JSON
      assert.isFalse(r.isFetching); // fresh: restored dataUpdatedAt + staleTime
      yield* settle;
      assert.strictEqual(second.count, 0);
    }).pipe(Effect.provide(KeyValueStore.layerMemory)),
  );

  it.effect("skips only the queries it cannot encode, and keeps the others", () =>
    Effect.gen(function* () {
      const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
      // Rejects numbers when encoding: the query's data does not fit its schema.
      const rejected = Query.single({
        key: ["rejected"],
        run: Effect.succeed(1 as unknown as string),
        persist: { schema: Schema.String },
      });
      // A key JSON cannot hold.
      const unserialisable = Query.single({
        key: [
          "unserialisable",
          {
            toJSON: () => {
              throw new Error("no JSON");
            },
          },
        ],
        run: Effect.succeed("x"),
        persist: { schema: Schema.String },
      });
      const a = yield* persistedClient();
      a.registry.mount(todosQuery(counter()));
      a.registry.mount(rejected);
      a.registry.mount(unserialisable);
      yield* settle;
      yield* TestClock.adjust("1 second"); // throttle
      yield* settle;
      const store = yield* KeyValueStore.KeyValueStore;
      const raw = Option.getOrThrow(Option.fromNullishOr(yield* store.get("effect-atom-query")));
      const queries = JSON.parse(raw).queries as ReadonlyArray<{ readonly key: string }>;
      assert.deepStrictEqual(
        queries.map((q) => q.key),
        [JSON.stringify(["todos", { page: 1 }])],
      );
      assert.strictEqual(warn.mock.calls.length, 0); // rejected data is expected, not a defect
      warn.mockRestore();
    }).pipe(Effect.provide(KeyValueStore.layerMemory)),
  );

  it.effect("discards snapshots with another buster or older than maxAge", () =>
    Effect.gen(function* () {
      const store = yield* KeyValueStore.KeyValueStore;
      const a = yield* persistedClient({ buster: "v1" });
      a.registry.mount(todosQuery(counter()));
      yield* settle;
      yield* a.close; // final write
      assert.isTrue(yield* store.has("effect-atom-query"));

      yield* persistedClient({ buster: "v2" });
      assert.isFalse(yield* store.has("effect-atom-query"));

      const c = yield* persistedClient({ buster: "v1", maxAge: "1 hour" });
      c.registry.mount(todosQuery(counter()));
      yield* settle;
      yield* c.close;
      yield* TestClock.adjust("2 hours");
      const runs = counter();
      const d = yield* persistedClient({ buster: "v1", maxAge: "1 hour" });
      d.registry.mount(todosQuery(runs));
      yield* settle;
      assert.strictEqual(runs.count, 1); // nothing restored: fetched
    }).pipe(Effect.provide(KeyValueStore.layerMemory)),
  );

  it.effect("drops data that no longer decodes and refetches", () =>
    Effect.gen(function* () {
      const store = yield* KeyValueStore.KeyValueStore;
      const a = yield* persistedClient();
      a.registry.mount(todosQuery(counter()));
      yield* settle;
      yield* a.close;
      const raw = JSON.parse((yield* store.get("effect-atom-query"))!);
      raw.queries[0].data = [{ title: 42 }];
      yield* store.set("effect-atom-query", JSON.stringify(raw));
      const runs = counter();
      const b = yield* persistedClient();
      b.registry.mount(todosQuery(runs));
      yield* settle;
      assert.strictEqual(runs.count, 1);
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
      assert.isFalse(yield* b.client.isRestoring);
      assert.isTrue(restoringAtStart);
      assert.deepStrictEqual(
        b.registry.get(q).data.pipe(Option.map((t) => t[0]!.title)),
        Option.some("todo 1"),
      );
      assert.strictEqual(runs.count, 0);
    }).pipe(Effect.provide(KeyValueStore.layerMemory)),
  );

  it.effect("starts a stream after a background restore, and refetches restored data", () =>
    Effect.gen(function* () {
      const live = (runs: ReturnType<typeof counter>, state: { opened: number }) =>
        Query.single({
          key: ["live-restored"],
          run: runs.tick,
          stream: {
            updates: Stream.unwrap(
              Effect.sync(() => {
                state.opened++;
                return Stream.never as Stream.Stream<number>;
              }),
            ),
            apply: Math.max,
          },
          staleTime: "Infinity",
          persist: { schema: Schema.Number },
        });
      const a = yield* persistedClient();
      a.registry.mount(live(counter(), { opened: 0 }));
      yield* settle;
      yield* a.close;

      const runs = counter();
      const state = { opened: 0 };
      const b = yield* persistedClient({ restore: "background" });
      assert.isTrue(yield* b.client.isRestoring);
      const q = live(runs, state);
      b.registry.mount(q);
      // Held back: there is no data and no fetch to give updates to.
      assert.strictEqual(state.opened, 0);
      yield* settle;
      assert.isFalse(yield* b.client.isRestoring);
      assert.strictEqual(state.opened, 1);
      // The restored data is from before the stream, whatever its `staleTime`.
      assert.strictEqual(runs.count, 1);
      assert.strictEqual(b.registry.get(q).stream?.status, "open");
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
      assert.deepInclude(a.registry.get(addTodo), { status: "pending", isPaused: true });
      yield* a.close;
      assert.deepStrictEqual(saved, []);

      const b = yield* persistedClient({ mutations: [addTodo] });
      yield* settle;
      assert.deepStrictEqual(saved, ["written offline"]);
      assert.strictEqual(yield* b.client.isMutating(), 0);
    }).pipe(Effect.provide(KeyValueStore.layerMemory)),
  );

  it.effect("has resumed restored mutations by the time a blocking restore is done", () =>
    Effect.gen(function* () {
      const started: Array<string> = [];
      const addTodo = Mutation.make({
        key: ["todos", "add-slow"],
        run: (title: string) =>
          Effect.andThen(
            Effect.sync(() => started.push(title)),
            Effect.never,
          ),
        persist: { variables: Schema.String },
      });
      const offline = OnlineManager.make({ setup: () => () => {}, initialOnline: false });
      const a = yield* persistedClient({ mutations: [addTodo] }, offline);
      a.registry.mount(addTodo);
      a.registry.set(addTodo, "written offline");
      yield* settle;
      yield* a.close;

      // No `settle`: the layer is built, so the mutation is already running.
      yield* persistedClient({ mutations: [addTodo] });
      assert.deepStrictEqual(started, ["written offline"]);
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
      assert.deepStrictEqual(r.data.value, {
        pages: [{ items: [0] }, { items: [1] }],
        pageParams: [0, 1],
      });
    }).pipe(Effect.provide(KeyValueStore.layerMemory)),
  );
});

/** A minimal Standard Schema v1 validator, as zod / Valibot / ArkType provide. */
const standard = <A>(
  guard: (u: unknown) => u is A,
  options?: { readonly async?: boolean },
): Query.StandardSchema<A> => ({
  "~standard": {
    version: 1,
    vendor: "test",
    validate: (value: unknown) => {
      const result = guard(value) ? { value } : { issues: [{ message: "invalid" }] };
      return options?.async === true ? Promise.resolve(result) : result;
    },
  },
});

interface Note {
  readonly id: number;
  readonly text: string;
}
const isNote = (u: unknown): u is Note =>
  typeof u === "object" &&
  u !== null &&
  typeof (u as Note).id === "number" &&
  typeof (u as Note).text === "string";
const isNotes = (u: unknown): u is ReadonlyArray<Note> => Array.isArray(u) && u.every(isNote);

const notesQuery = (runs: ReturnType<typeof counter>, schema = standard(isNotes)) =>
  Query.single({
    key: ["notes"],
    run: runs.tick.pipe(Effect.map((n) => [{ id: n, text: `note ${n}` }])),
    staleTime: "1 hour",
    persist: { schema },
  });

describe("QueryPersister with Standard Schema validators", () => {
  it.effect("round-trips a query validated by a Standard Schema", () =>
    Effect.gen(function* () {
      const a = yield* persistedClient();
      a.registry.mount(notesQuery(counter()));
      yield* settle;
      yield* a.close;

      const runs = counter();
      const b = yield* persistedClient();
      const q = notesQuery(runs);
      b.registry.mount(q);
      const r = b.registry.get(q);
      assert(r.isSuccess);
      assert.deepStrictEqual(r.data.value, [{ id: 1, text: "note 1" }]);
      yield* settle;
      assert.strictEqual(runs.count, 0);
    }).pipe(Effect.provide(KeyValueStore.layerMemory)),
  );

  it.effect("drops data the validator rejects, and refetches", () =>
    Effect.gen(function* () {
      const store = yield* KeyValueStore.KeyValueStore;
      const a = yield* persistedClient();
      a.registry.mount(notesQuery(counter()));
      yield* settle;
      yield* a.close;
      const raw = JSON.parse((yield* store.get("effect-atom-query"))!);
      raw.queries[0].data = [{ id: "not a number", text: "x" }];
      yield* store.set("effect-atom-query", JSON.stringify(raw));

      const runs = counter();
      const b = yield* persistedClient();
      b.registry.mount(notesQuery(runs));
      yield* settle;
      assert.strictEqual(runs.count, 1);
    }).pipe(Effect.provide(KeyValueStore.layerMemory)),
  );

  it.effect("treats an async validator as undecodable, and warns", () =>
    Effect.gen(function* () {
      const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
      const asyncSchema = standard(isNotes, { async: true });
      const a = yield* persistedClient();
      a.registry.mount(notesQuery(counter(), asyncSchema));
      yield* settle;
      yield* a.close;

      const runs = counter();
      const b = yield* persistedClient();
      b.registry.mount(notesQuery(runs, asyncSchema));
      yield* settle;
      assert.strictEqual(runs.count, 1);
      assert.strictEqual(warn.mock.calls.length, 1);
      assert.include(String(warn.mock.calls[0]![0]), "asynchronous");
      warn.mockRestore();
    }).pipe(Effect.provide(KeyValueStore.layerMemory)),
  );

  it.effect("uses the Effect Schema codec for a schema that also has ~standard", () =>
    Effect.gen(function* () {
      // Effect schemas can carry `~standard`; their codec must still win, so
      // non-JSON values like DateTime round-trip.
      const schema = Object.assign(Schema.Array(Todo), {
        "~standard": standard(isNotes)["~standard"], // would reject todos
      });
      const make = (runs: ReturnType<typeof counter>) =>
        Query.single({
          key: ["todos-both"],
          run: runs.tick.pipe(
            Effect.map(() => [
              { title: "t", due: Option.some(DateTime.makeUnsafe(Date.UTC(2026, 10, 13))) },
            ]),
          ),
          staleTime: "1 hour",
          persist: { schema },
        });
      const a = yield* persistedClient();
      a.registry.mount(make(counter()));
      yield* settle;
      yield* a.close;
      const b = yield* persistedClient();
      const q = make(counter());
      b.registry.mount(q);
      const r = b.registry.get(q);
      assert(r.isSuccess);
      assert.isTrue(DateTime.isDateTime(Option.getOrThrow(r.data.value[0]!.due)));
    }).pipe(Effect.provide(KeyValueStore.layerMemory)),
  );

  it.effect("persists infinite queries with Standard Schema pages and params", () =>
    Effect.gen(function* () {
      const isPage = (u: unknown): u is { readonly items: ReadonlyArray<number> } =>
        typeof u === "object" && u !== null && Array.isArray((u as { items: unknown }).items);
      const feed = InfiniteQuery.make({
        key: () => ["feed-standard"],
        run: (_: void, cursor: number) => Effect.succeed({ items: [cursor] }),
        initialPageParam: 0,
        getNextPageParam: (_last, _all, cursor) => Option.some(cursor + 1),
        staleTime: "1 hour",
        persist: {
          page: standard(isPage),
          pageParam: standard((u: unknown): u is number => typeof u === "number"),
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
      assert.deepStrictEqual(r.data.value, {
        pages: [{ items: [0] }, { items: [1] }],
        pageParams: [0, 1],
      });
    }).pipe(Effect.provide(KeyValueStore.layerMemory)),
  );

  it.effect("drops infinite query data whose pages and params do not line up", () =>
    Effect.gen(function* () {
      const runs = counter();
      const feed = InfiniteQuery.make({
        key: () => ["feed-corrupt"],
        run: (_: void, cursor: number) => runs.tick.pipe(Effect.as({ items: [cursor] })),
        initialPageParam: 0,
        getNextPageParam: () => Option.none(),
        staleTime: "1 hour",
        persist: {
          page: Schema.Struct({ items: Schema.Array(Schema.Number) }),
          pageParam: Schema.Number,
        },
      });
      const store = yield* KeyValueStore.KeyValueStore;
      const a = yield* persistedClient();
      a.registry.mount(feed());
      yield* settle;
      yield* a.close;
      const raw = JSON.parse((yield* store.get("effect-atom-query"))!);
      raw.queries[0].data.pageParams = [0, 1];
      yield* store.set("effect-atom-query", JSON.stringify(raw));
      const before = runs.count;
      const b = yield* persistedClient();
      b.registry.mount(feed());
      yield* settle;
      // Restored data would be fresh for an hour: a fetch means it was dropped.
      assert.strictEqual(runs.count, before + 1);
    }).pipe(Effect.provide(KeyValueStore.layerMemory)),
  );

  it.effect("persists mutation variables with a Standard Schema", () =>
    Effect.gen(function* () {
      const saved: Array<string> = [];
      const addNote = Mutation.make({
        key: ["notes", "add"],
        run: (text: string) => Effect.sync(() => saved.push(text)),
        persist: { variables: standard((u: unknown): u is string => typeof u === "string") },
      });
      const offline = OnlineManager.make({ setup: () => () => {}, initialOnline: false });
      const a = yield* persistedClient({ mutations: [addNote] }, offline);
      a.registry.mount(addNote);
      a.registry.set(addNote, "written offline");
      yield* settle;
      yield* a.close;
      yield* persistedClient({ mutations: [addNote] });
      yield* settle;
      assert.deepStrictEqual(saved, ["written offline"]);
    }).pipe(Effect.provide(KeyValueStore.layerMemory)),
  );

  it.effect("skips Standard Schema data that is not JSON, and still persists the rest", () =>
    Effect.gen(function* () {
      // Standard Schema data is stored as is; a bigint is not JSON.
      const notJson = Query.single({
        key: ["not-json"],
        run: Effect.succeed({ n: 1n }),
        persist: { schema: standard((u: unknown): u is { n: bigint } => typeof u === "object") },
      });
      const a = yield* persistedClient();
      a.registry.mount(notesQuery(counter()));
      a.registry.mount(notJson);
      yield* settle;
      yield* TestClock.adjust("1 second"); // throttle
      yield* settle;
      const store = yield* KeyValueStore.KeyValueStore;
      const raw = Option.getOrThrow(Option.fromNullishOr(yield* store.get("effect-atom-query")));
      const queries = JSON.parse(raw).queries as ReadonlyArray<{ readonly key: string }>;
      assert.deepStrictEqual(
        queries.map((q) => q.key),
        [JSON.stringify(["notes"])],
      );
      yield* a.close; // the final write must not die either
    }).pipe(Effect.provide(KeyValueStore.layerMemory)),
  );

  it.effect("skips data no JSON can hold whatever the schema, and still persists the rest", () =>
    Effect.gen(function* () {
      // `Schema.Any` passes values through, so its codec does not catch the bigint.
      const notJson = Query.single({
        key: ["not-json-any"],
        run: Effect.succeed({ n: 1n }),
        persist: { schema: Schema.Any },
      });
      const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
      const a = yield* persistedClient();
      a.registry.mount(notesQuery(counter()));
      a.registry.mount(notJson);
      yield* settle;
      yield* TestClock.adjust("1 second"); // throttle
      yield* settle;
      const store = yield* KeyValueStore.KeyValueStore;
      const raw = Option.getOrThrow(Option.fromNullishOr(yield* store.get("effect-atom-query")));
      const queries = JSON.parse(raw).queries as ReadonlyArray<{ readonly key: string }>;
      assert.deepStrictEqual(
        queries.map((q) => q.key),
        [JSON.stringify(["notes"])],
      );
      yield* a.close;
      // Says which query was skipped, once (not on every write).
      assert.strictEqual(warn.mock.calls.length, 1);
      assert.include(String(warn.mock.calls[0]?.[0]), '["not-json-any"]');
      warn.mockRestore();
    }).pipe(Effect.provide(KeyValueStore.layerMemory)),
  );

  it.effect("persists Standard Schema data as JSON.stringify would write it", () =>
    Effect.gen(function* () {
      // An `undefined` field is not a JSON value, but stringify just drops it.
      const optional = Query.single({
        key: ["optional-field"],
        run: Effect.succeed({ id: 1, note: undefined }),
        persist: { schema: standard((u: unknown): u is { id: number } => typeof u === "object") },
      });
      const a = yield* persistedClient();
      a.registry.mount(optional);
      yield* settle;
      yield* a.close;
      const store = yield* KeyValueStore.KeyValueStore;
      const raw = Option.getOrThrow(Option.fromNullishOr(yield* store.get("effect-atom-query")));
      const queries = JSON.parse(raw).queries as ReadonlyArray<{ readonly data: unknown }>;
      assert.deepStrictEqual(
        queries.map((q) => q.data),
        [{ id: 1 }],
      );
    }).pipe(Effect.provide(KeyValueStore.layerMemory)),
  );

  it("types the validator's output against the query's data", () => {
    Query.single({
      key: ["typed"],
      run: Effect.succeed([{ id: 1, text: "a" }]),
      persist: { schema: standard(isNotes) },
    });
    Query.single({
      key: ["mistyped"],
      run: Effect.succeed("a string"),
      // @ts-expect-error validates notes, but the query returns a string
      persist: { schema: standard(isNotes) },
    });
  });
});
