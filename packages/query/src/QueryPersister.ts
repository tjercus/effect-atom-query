/**
 * Persist the query cache (and offline mutations) to a `KeyValueStore`:
 * localStorage, sessionStorage, IndexedDB, the file system, SQL… This is
 * TanStack's `persistQueryClient`, typed with `Schema`.
 *
 * ```ts
 * const todos = Query.single({
 *   key: ["todos"],
 *   run: TodoRepo.list,
 *   persist: { schema: Schema.Array(Todo) },   // opt in, per query
 *   gcTime: "24 hours",                        // keep >= maxAge, or entries vanish before they are saved
 * })
 *
 * const AppLayer = QueryPersister.layer({ buster: "v1" }).pipe(
 *   Layer.provideMerge(QueryClient.layer()),
 *   Layer.provide(KeyValueStore.layerStorage(() => localStorage)),
 * )
 * ```
 *
 * - Only queries with `persist` are stored, and only successful ones (by
 *   default). Restored data is decoded with the query's own schema when its
 *   atom first needs it, so a schema change simply drops old data.
 * - The whole snapshot is discarded when `buster` changes or it is older than
 *   `maxAge`.
 * - Mutations with `persist` that are paused (offline) are stored too and
 *   resumed after restoring. Pass them in `mutations` so the restored
 *   executions have a `run` (functions cannot be stored).
 *
 * @since 0.1.0
 */
import { Duration, Effect, Fiber, Layer, Option, Result, Schema } from "effect";
import { KeyValueStore } from "effect/persistence";
import { jsonKey, keyLabel } from "./internal/jsonKey.ts";
import { persistCodec } from "./internal/persistCodec.ts";
import type * as Mutation from "./Mutation.ts";
import * as QueryClient from "./QueryClient.ts";
import * as QueryKey from "./QueryKey.ts";
import type * as QueryResult from "./QueryResult.ts";

/**
 * @since 0.1.0
 * @category models
 */
export interface Options {
  /** Storage key. Default `"effect-atom-query"`. */
  readonly storageKey?: string | undefined;
  /** Change it to invalidate every stored snapshot (e.g. on deploy). Default `""`. */
  readonly buster?: string | undefined;
  /** Snapshots older than this are discarded. Default 24 hours. */
  readonly maxAge?: Duration.Input | undefined;
  /** Coalesce writes. Default 1 second. */
  readonly throttle?: Duration.Input | undefined;
  /**
   * `"blocking"` (default) restores while the layer is built, so the first
   * render already has the data (fine for synchronous storage).
   * `"background"` restores in a fiber; meanwhile `isRestoring` is true and
   * queries do not fetch on mount.
   */
  readonly restore?: "blocking" | "background" | undefined;
  /** Mutations that may be restored; their definitions become mutation defaults. */
  readonly mutations?: ReadonlyArray<Mutation.MutationAtom<any, any, any, any, any>> | undefined;
  /** Resume restored mutations right after restoring. Default `true`. */
  readonly resumePausedMutations?: boolean | undefined;
  /** Which persisted queries to store. Default: successful ones. */
  readonly shouldPersistQuery?:
    | ((query: {
        readonly key: QueryKey.QueryKey;
        readonly result: QueryResult.QueryResult<unknown, unknown>;
      }) => boolean)
    | undefined;
}

/**
 * The stored snapshot.
 *
 * @since 0.1.0
 * @category schemas
 */
export const PersistedClient = Schema.Struct({
  buster: Schema.String,
  timestamp: Schema.Number,
  queries: Schema.Array(
    Schema.Struct({
      key: Schema.String,
      queryKey: Schema.Json,
      data: Schema.Json,
      dataUpdatedAt: Schema.Number,
    }),
  ),
  mutations: Schema.Array(
    Schema.Struct({
      mutationKey: Schema.Json,
      variables: Schema.Json,
      submittedAt: Schema.Number,
    }),
  ),
});

/**
 * @since 0.1.0
 * @category schemas
 */
export type PersistedClient = typeof PersistedClient.Type;

const PersistedClientJson = Schema.fromJsonString(PersistedClient);
const decodeSnapshot = Schema.decodeUnknownOption(PersistedClientJson);

/**
 * A codec's output as `JSON.stringify` writes it, or a failure for what it
 * cannot write (a bigint, a cycle). Codecs are not trusted to emit JSON: a
 * Standard Schema does not encode, and `Schema.Any` passes values through.
 * One value that is not JSON would otherwise make every write fail.
 */
const toJson = (value: unknown): Result.Result<Schema.Json, unknown> =>
  Result.try(() => JSON.parse(JSON.stringify(value)) as Schema.Json);

/** Entries already reported by `notJson`: a snapshot is taken on every write. */
const reported = new WeakSet<object>();

const notJson = (entry: object, what: string, key: ReadonlyArray<unknown>, cause: unknown) => {
  if (!reported.has(entry)) {
    reported.add(entry);
    console.warn(
      `effect-atom-query: ${what} ${keyLabel(key)} was not persisted, because JSON cannot hold it.`,
      cause,
    );
  }
};

const resolve = (options: Options = {}) => ({
  storageKey: options.storageKey ?? "effect-atom-query",
  buster: options.buster ?? "",
  maxAge: Duration.toMillis(Duration.fromInputUnsafe(options.maxAge ?? "24 hours")),
  throttle: Duration.fromInputUnsafe(options.throttle ?? "1 second"),
  restore: options.restore ?? "blocking",
  mutations: options.mutations ?? [],
  resumePausedMutations: options.resumePausedMutations ?? true,
  shouldPersistQuery:
    options.shouldPersistQuery ??
    ((query: { readonly result: QueryResult.QueryResult<unknown, unknown> }) =>
      query.result.status === "success"),
});

type Resolved = ReturnType<typeof resolve>;

/**
 * Take a snapshot of the client's persisted queries and paused mutations.
 *
 * @since 0.1.0
 * @category persisting
 */
export const dehydrate = (
  client: QueryClient.Service,
  options?: Options,
): Effect.Effect<PersistedClient> => Effect.sync(() => snapshot(client, resolve(options)));

const snapshot = (client: QueryClient.Service, options: Resolved): PersistedClient => {
  const now = client.runtime.now();
  const queries: Array<PersistedClient["queries"][number]> = [];
  const seen = new Set<string>();
  for (const entry of client.cache.all()) {
    const codec = entry.descriptor.persist;
    if (codec === undefined || Option.isNone(entry.state.data)) {
      continue;
    }
    if (!options.shouldPersistQuery({ key: entry.key, result: entry.toResult() })) {
      continue;
    }
    // Not encodable (a non-JSON key, or data the schema rejects): skip this query.
    const key = jsonKey(entry.key);
    if (Result.isFailure(key)) {
      continue;
    }
    const encoded = codec.encode(entry.state.data.value);
    if (Result.isFailure(encoded)) {
      continue;
    }
    const data = toJson(encoded.success);
    if (Result.isFailure(data)) {
      notJson(entry, "the data of query", entry.key, data.failure);
      continue;
    }
    queries.push({
      key: key.success,
      queryKey: JSON.parse(key.success) as Schema.Json,
      data: data.success,
      dataUpdatedAt: entry.state.dataUpdatedAt,
    });
    seen.add(key.success);
  }
  // Restored data no atom has claimed yet is kept, not lost, until it is
  // older than `maxAge` (each write would otherwise renew it indefinitely).
  for (const [key, preloaded] of client.runtime.preloaded) {
    if (now - preloaded.dataUpdatedAt > options.maxAge) {
      client.runtime.preloaded.delete(key);
      continue;
    }
    if (seen.has(key)) {
      continue;
    }
    queries.push({
      key,
      queryKey: preloaded.queryKey as Schema.Json,
      data: preloaded.data as Schema.Json,
      dataUpdatedAt: preloaded.dataUpdatedAt,
    });
  }

  const mutations: Array<PersistedClient["mutations"][number]> = [];
  for (const entry of client.mutationCache.all()) {
    const persist = entry.options.persist;
    const state = entry.state;
    if (persist === undefined || entry.key === undefined) {
      continue;
    }
    if (state.status !== "pending" || !state.isPaused || Option.isNone(state.variables)) {
      continue;
    }
    // Not encodable: skip.
    const key = jsonKey(entry.key);
    if (Result.isFailure(key)) {
      continue;
    }
    const encoded = persistCodec(persist.variables).encode(state.variables.value);
    if (Result.isFailure(encoded)) {
      continue;
    }
    const variables = toJson(encoded.success);
    if (Result.isFailure(variables)) {
      notJson(entry, "the variables of mutation", entry.key, variables.failure);
      continue;
    }
    mutations.push({
      mutationKey: JSON.parse(key.success) as Schema.Json,
      variables: variables.success,
      submittedAt: state.submittedAt,
    });
  }
  return { buster: options.buster, timestamp: now, queries, mutations };
};

/**
 * Load a snapshot into the client: queries become claimable by their atoms,
 * mutations are re-created as paused executions.
 *
 * @since 0.1.0
 * @category persisting
 */
export const hydrate = (
  client: QueryClient.Service,
  persisted: PersistedClient,
): Effect.Effect<void> =>
  Effect.sync(() => {
    for (const query of persisted.queries) {
      client.runtime.preloaded.set(query.key, query);
      // An entry exists already: let it claim the data if it is still empty.
      const entry = client.cache.get(query.queryKey as QueryKey.QueryKey);
      if (Option.isSome(entry)) {
        entry.value.claimPersisted();
      }
    }
    for (const mutation of persisted.mutations) {
      const key = mutation.mutationKey as ReadonlyArray<unknown>;
      const defaults = client.mutationCache.defaultsFor(key);
      if (defaults.run === undefined || defaults.persist === undefined) {
        continue;
      }
      const variables = persistCodec(defaults.persist.variables).decode(mutation.variables);
      if (Result.isFailure(variables)) {
        continue;
      }
      client.mutationCache.restore(key, variables.success, mutation.submittedAt);
    }
  });

// `@__PURE__`: a top-level call is kept by bundlers unless marked, which would
// pull persistence into every bundle that imports the package.
const readSnapshot: (
  client: QueryClient.Service,
  store: KeyValueStore.KeyValueStore,
  options: Resolved,
) => Effect.Effect<Option.Option<PersistedClient>> = /* @__PURE__ */ Effect.fnUntraced(
  function* (client: QueryClient.Service, store: KeyValueStore.KeyValueStore, options: Resolved) {
    const raw = yield* store.get(options.storageKey);
    if (raw === undefined) {
      return Option.none();
    }
    const decoded = decodeSnapshot(raw);
    const valid = Option.filter(
      decoded,
      (snapshot) =>
        snapshot.buster === options.buster &&
        client.runtime.now() - snapshot.timestamp <= options.maxAge,
    );
    if (Option.isNone(valid)) {
      yield* store.remove(options.storageKey);
    }
    return valid;
  },
  // Unreadable storage restores nothing, but says why.
  Effect.catch((error) =>
    Effect.as(
      Effect.logWarning("effect-atom-query: the persisted snapshot could not be read", error),
      Option.none<PersistedClient>(),
    ),
  ),
);

/**
 * Restore the client from storage once.
 *
 * @since 0.1.0
 * @category persisting
 */
export const restore: (
  options?: Options,
) => Effect.Effect<void, never, QueryClient.QueryClient | KeyValueStore.KeyValueStore> =
  /* @__PURE__ */ Effect.fnUntraced(function* (options?: Options) {
    const client = yield* QueryClient.QueryClient;
    const store = yield* KeyValueStore.KeyValueStore;
    const resolved = resolve(options);
    const persisted = yield* readSnapshot(client, store, resolved);
    if (Option.isSome(persisted)) {
      yield* hydrate(client, persisted.value);
    }
  });

/**
 * Write the current snapshot to storage once.
 *
 * @since 0.1.0
 * @category persisting
 */
export const persist: (
  options?: Options,
) => Effect.Effect<
  void,
  KeyValueStore.KeyValueStoreError,
  QueryClient.QueryClient | KeyValueStore.KeyValueStore
> = /* @__PURE__ */ Effect.fnUntraced(function* (options?: Options) {
  const client = yield* QueryClient.QueryClient;
  const store = yield* KeyValueStore.KeyValueStore;
  const resolved = resolve(options);
  // `snapshot` holds JSON values only (see `toJson`), and the stored form of
  // `PersistedClient` is the value itself, so this is a plain stringify.
  yield* store.set(resolved.storageKey, JSON.stringify(snapshot(client, resolved)));
});

/**
 * Remove the stored snapshot (e.g. on logout).
 *
 * @since 0.1.0
 * @category persisting
 */
export const removeClient = (
  options?: Options,
): Effect.Effect<void, KeyValueStore.KeyValueStoreError, KeyValueStore.KeyValueStore> =>
  Effect.flatMap(KeyValueStore.KeyValueStore, (store) => store.remove(resolve(options).storageKey));

/**
 * Restore on startup, then keep storage in sync (throttled) while the layer
 * is alive; a final snapshot is written when it closes.
 *
 * @since 0.1.0
 * @category layers
 */
export const layer = (
  options?: Options,
): Layer.Layer<never, never, QueryClient.QueryClient | KeyValueStore.KeyValueStore> =>
  Layer.effectDiscard(
    Effect.gen(function* () {
      const client = yield* QueryClient.QueryClient;
      const context = yield* Effect.context<
        KeyValueStore.KeyValueStore | QueryClient.QueryClient
      >();
      const resolved = resolve(options);
      for (const mutation of resolved.mutations) {
        if (mutation.key !== undefined) {
          yield* client.setMutationDefaults(mutation.key, mutation.options);
        }
      }

      // Detached: resuming must not hold up the restore, nor stop with this
      // layer (the mutations themselves run in the client's context).
      const afterRestore = resolved.resumePausedMutations
        ? Effect.forkDetach(client.resumePausedMutations, { startImmediately: true })
        : Effect.void;
      const restoring = client.runtime.restoring;
      restoring.start();
      const restoreOnce = restore(options).pipe(
        Effect.ensuring(Effect.sync(() => restoring.finish())),
        Effect.andThen(afterRestore),
      );
      if (resolved.restore === "blocking") {
        yield* restoreOnce;
      } else {
        yield* Effect.forkScoped(restoreOnce);
      }

      const write = persist(options).pipe(
        Effect.provideContext(context),
        Effect.ignore({ log: false }),
      );
      let pending: Fiber.Fiber<void> | undefined;
      const schedule = () => {
        if (pending !== undefined || restoring.isRestoring()) {
          return;
        }
        pending = client.runtime.runFork(
          Effect.sleep(resolved.throttle).pipe(
            Effect.andThen(Effect.sync(() => (pending = undefined))),
            Effect.andThen(write),
          ),
        );
      };
      const unsubscribeQueries = client.cache.subscribe(schedule);
      const unsubscribeMutations = client.mutationCache.subscribe(schedule);
      yield* Effect.addFinalizer(() =>
        Effect.suspend(() => {
          unsubscribeQueries();
          unsubscribeMutations();
          // A throttled write must not land after the final one (or after
          // `removeClient`).
          const throttled = pending;
          pending = undefined;
          const stopThrottled = throttled ? Fiber.interrupt(throttled) : Effect.void;
          // Closed before a background restore finished: the cache does not
          // reflect storage yet, so writing it would wipe the stored snapshot.
          return restoring.isRestoring() ? stopThrottled : Effect.andThen(stopThrottled, write);
        }),
      );
    }),
  );
