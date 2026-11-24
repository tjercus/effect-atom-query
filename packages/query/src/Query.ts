/**
 * Query definitions (decision D1: atom-first).
 *
 * ```ts
 * const todoQuery = Query.make({
 *   key: (id: TodoId) => ["todos", id],
 *   run: (id) => TodoRepo.use((repo) => repo.get(id)),
 *   staleTime: "30 seconds",
 * })
 *
 * registry.get(todoQuery(id))          // Atom<QueryResult<Todo, TodoError>>
 * client.fetchQuery(todoQuery(id))     // Effect<Todo, TodoError, TodoRepo>
 * ```
 *
 * @since 0.1.0
 */
import { type Context, type Effect, Option, type Stream } from "effect";
import { AsyncResult, Atom } from "effect/reactivity";
import {
  FetchAttempt as InternalFetchAttempt,
  type InitialData,
  type QueryDescriptor,
  type QueryEntry,
  type QueryOptions as InternalQueryOptions,
  type RetryOption,
} from "./internal/queryEntry.ts";
import {
  persistCodec,
  type PersistSchema as InternalPersistSchema,
  type StandardSchema as InternalStandardSchema,
} from "./internal/persistCodec.ts";
import * as QueryClient from "./QueryClient.ts";
import type * as QueryKey from "./QueryKey.ts";
import * as QueryResult from "./QueryResult.ts";

/**
 * @since 0.1.0
 * @category symbols
 */
export const TypeId: TypeId = "~@effect-atom-query/query/Query";

/**
 * @since 0.1.0
 * @category symbols
 */
export type TypeId = "~@effect-atom-query/query/Query";

/**
 * Which attempt of the current fetch is running, for a query's `run`:
 * `attempt` is `0` on the first try and counts up on each retry. Use it to
 * change how the request is made without changing the query key, for example
 * to bypass an HTTP cache when retrying:
 *
 * ```ts
 * const todosQuery = Query.single({
 *   key: ["todos"],
 *   run: Effect.gen(function* () {
 *     const { attempt } = yield* Query.FetchAttempt
 *     return yield* TodoRepo.use((repo) => repo.list({ noCache: attempt > 0 }))
 *   }),
 * })
 * ```
 *
 * It is a `Context.Reference`, so reading it adds nothing to the query's `R`.
 * Outside a fetch it reads `{ attempt: 0 }`.
 *
 * For options chosen by the caller of a refetch, provide your own services to
 * `QueryClient.refetchQueries` (or `fetchQuery`, `invalidateQueries`,
 * `resetQueries`): the fetches they start run with the caller's services.
 *
 * @since 1.4.0
 * @category services
 */
export const FetchAttempt: Context.Reference<{ readonly attempt: number }> = InternalFetchAttempt;

/**
 * Per-query options. Unset options fall back to the client's
 * `defaultOptions.queries`, then to TanStack's defaults:
 *
 * | option              | default                                       |
 * | ------------------- | --------------------------------------------- |
 * | `staleTime`         | `0`; `"Infinity"` until invalidated; `"static"` never, not even when invalidated |
 * | `gcTime`            | `"5 minutes"`                                 |
 * | `retry`             | `3`, exponential backoff from 1 s capped at 30 s. A number, `boolean` or any `Schedule` |
 * | `refetchOnMount`    | `true` (when stale); `"always"`               |
 * | `enabled`           | `true`                                        |
 * | `structuralSharing` | `true`                                        |
 *
 * @since 0.1.0
 * @category models
 */
export type QueryOptions<E> = InternalQueryOptions<E>;

/**
 * A query instance: an atom holding its `QueryResult`, plus everything the
 * client needs to fetch it.
 *
 * Reading the atom registers an observer: it fetches on mount when the data is
 * missing or stale, and keeps the cache entry from being garbage collected.
 * Refreshing the atom (`registry.refresh`, `useAtomRefresh`) forces a refetch.
 *
 * @since 0.1.0
 * @category models
 */
export interface QueryAtom<A, E = never, R = never> extends Atom.Atom<
  QueryResult.QueryResult<A, E>
> {
  readonly [TypeId]: TypeId;
  readonly key: QueryKey.Tagged<A, E>;
  readonly run: Effect.Effect<A, E, R>;
  /**
   * The definition's options. Typed loosely (`any` error) so that `E` stays
   * covariant and any query atom fits `QueryAtom<any, any, any>`.
   */
  readonly options: QueryOptions<any>;
  readonly initialData?: InitialData<A> | undefined;
}

/**
 * A query instance whose definition has `initialData`, so data is always
 * present. Hooks narrow its result to {@link DefinedQueryResult}.
 *
 * @since 0.1.0
 * @category models
 */
export interface DefinedQueryAtom<A, E = never, R = never> extends QueryAtom<A, E, R> {
  readonly initialData: InitialData<A>;
}

/**
 * A result whose data is known to be present.
 *
 * @since 0.1.0
 * @category models
 */
export type DefinedQueryResult<A, E = never> =
  | QueryResult.Success<A, E>
  | (QueryResult.Failure<A, E> & { readonly data: Option.Some<A> });

/**
 * A disabled query instance, produced by passing {@link skipToken}. It never
 * fetches and has no cache entry.
 *
 * @since 0.1.0
 * @category models
 */
export interface SkippedQueryAtom<A, E = never> extends Atom.Atom<QueryResult.QueryResult<A, E>> {
  readonly [TypeId]: TypeId;
  readonly skipped: true;
}

/**
 * Pass instead of an argument to disable a query in a type-safe way:
 * `todoQuery(id ?? Query.skipToken)`.
 *
 * @since 0.1.0
 * @category symbols
 */
export const skipToken: unique symbol = Symbol.for("@effect-atom-query/query/skipToken");

/**
 * @since 0.1.0
 * @category symbols
 */
export type SkipToken = typeof skipToken;

/**
 * @since 0.1.0
 * @category models
 */
export interface QueryFamily<
  Arg,
  A,
  E = never,
  R = never,
  Q extends QueryAtom<A, E, R> = QueryAtom<A, E, R>,
> {
  (arg: Arg): Q;
  (arg: Arg | SkipToken): Q | SkippedQueryAtom<A, E>;
  /** The typed key for an argument, for `getQueryData` and filters. */
  readonly key: (arg: Arg) => QueryKey.Tagged<A, E>;
}

/**
 * Live updates for a query. `run` fetches a snapshot of the data; `updates`
 * is a stream of changes to it (from a WebSocket or server-sent events, say),
 * and `apply` puts one change into the data:
 *
 * ```ts
 * const messagesQuery = Query.make({
 *   key: (room: string) => ["messages", room],
 *   run: (room) => Chat.use((chat) => chat.history(room)),
 *   stream: {
 *     updates: (room) => Stream.unwrap(Chat.use((chat) => chat.subscribe(room))),
 *     apply: (messages, message) =>
 *       messages.some((m) => m.id === message.id)
 *         ? messages.map((m) => (m.id === message.id ? message : m))
 *         : [...messages, message],
 *   },
 *   staleTime: "Infinity",
 * })
 * ```
 *
 * The stream runs while the query has an enabled observer, and for one second
 * after the last one left. It starts together with the first fetch; updates
 * that arrive while the first fetch runs are applied to its result. Data
 * fetched before the stream ran is refetched by the first observer.
 *
 * **`apply` must be idempotent**: applying an update that the data already
 * contains must change nothing (replace by id in place, do not append). Updates that
 * arrive while a fetch runs are applied to the current data, and again to the
 * fetched data, which may already contain them. The fetched data may also
 * hold a later change of the same item: if updates can arrive late, `apply`
 * should compare versions and ignore an update that is not newer.
 *
 * A failing stream does not fail the query: see `streamStatus` and
 * `streamError` on the result. It is retried with `retry`. A failure marks
 * the data stale, since updates are missed; it is refetched when the first
 * update after the failure arrives. When the stream stops for lack of
 * observers, the query is invalidated too, so the next observer refetches.
 *
 * `updates` is fixed when the stream starts; `apply` is always the one of
 * the latest definition for the key.
 *
 * The stream runs with the services of the client's runtime.
 *
 * The library cannot tell when the stream's subscription is established. A
 * change made after the snapshot was taken and before the subscription is
 * live is in neither of them, and stays missing until something refetches
 * the query. A server can close this gap by sending the current state as the
 * first update.
 *
 * @since 1.5.0
 * @category models
 */
export interface StreamDefinition<A, U, SE = never, SR = never> {
  readonly updates: Stream.Stream<U, SE, SR>;
  /** Puts one update into the data. Must be idempotent, and must not throw. */
  readonly apply: (data: NoInfer<A>, update: NoInfer<U>) => NoInfer<A>;
  /**
   * How a failed stream is retried. Default `true`: exponential backoff from
   * 1 s capped at 30 s, without a limit; the backoff starts over after an
   * update. A number limits the retries, `false` disables them, and any
   * `Schedule` can inspect the typed error.
   */
  readonly retry?: RetryOption<NoInfer<SE>> | undefined;
}

/**
 * {@link StreamDefinition} for a parameterised query: `updates` takes the
 * query's argument.
 *
 * @since 1.5.0
 * @category models
 */
export interface StreamFamilyDefinition<Arg, A, U, SE = never, SR = never> extends Omit<
  StreamDefinition<A, U, SE, SR>,
  "updates"
> {
  readonly updates: (arg: Arg) => Stream.Stream<U, SE, SR>;
}

/**
 * @since 0.1.0
 * @category models
 */
export interface Definition<Arg, A, E, R, U = never, SE = never, SR = never> extends Omit<
  QueryOptions<E>,
  "enabled"
> {
  readonly key: (arg: Arg) => QueryKey.QueryKey;
  readonly run: (arg: Arg) => Effect.Effect<A, E, R>;
  readonly enabled?: boolean | ((arg: Arg) => boolean) | undefined;
  /** Seeds the cache entry. It is still stale unless `staleTime` says otherwise. */
  readonly initialData?: ((arg: Arg) => A) | undefined;
  /** Epoch millis the initial data is from. Defaults to now. */
  readonly initialDataUpdatedAt?: ((arg: Arg) => number) | undefined;
  /** Opt into persistence (`QueryPersister`): the data is stored with this schema's JSON codec. */
  readonly persist?: Persist<A> | undefined;
  /** Live updates to the data. See {@link StreamDefinition}. */
  readonly stream?: StreamFamilyDefinition<Arg, A, U, SE, SR> | undefined;
}

/**
 * A [Standard Schema v1](https://standardschema.dev) validator producing `A`,
 * such as a zod, Valibot or ArkType schema.
 *
 * @since 1.3.0
 * @category models
 */
export type StandardSchema<A> = InternalStandardSchema<A>;

/**
 * What persisted data is stored and restored with:
 *
 * - an Effect `Schema`: data is encoded with its JSON codec and decoded when
 *   restored, so `DateTime`, `Option` and branded types round-trip;
 * - a Standard Schema validator (zod, Valibot, ArkType): data is stored as
 *   is, so it must be JSON-compatible, and validated when restored. The
 *   validator must be synchronous, and must accept its own output (no
 *   transforms that change the type).
 *
 * @since 1.3.0
 * @category models
 */
export type PersistSchema<A> = InternalPersistSchema<A>;

/**
 * Persistence of a query's data. The key must be JSON-compatible.
 *
 * @since 0.1.0
 * @category models
 */
export interface Persist<A> {
  readonly schema: PersistSchema<A>;
}

/**
 * @since 0.1.0
 * @category models
 */
export interface SingleDefinition<
  A,
  E,
  R,
  U = never,
  SE = never,
  SR = never,
> extends QueryOptions<E> {
  readonly key: QueryKey.QueryKey;
  readonly run: Effect.Effect<A, E, R>;
  readonly initialData?: (() => A) | undefined;
  readonly initialDataUpdatedAt?: (() => number) | undefined;
  readonly persist?: Persist<A> | undefined;
  /** Live updates to the data. See {@link StreamDefinition}. */
  readonly stream?: StreamDefinition<A, U, SE, SR> | undefined;
}

/**
 * @since 0.1.0
 * @category guards
 */
export const isQueryAtom: {
  <A, E, R>(u: QueryAtom<A, E, R> | SkippedQueryAtom<A, E>): u is QueryAtom<A, E, R>;
  (u: unknown): u is QueryAtom<unknown, unknown, unknown>;
} = (u: unknown): u is QueryAtom<unknown, unknown, unknown> =>
  Atom.isAtom(u) && TypeId in u && !("skipped" in u);

/**
 * @since 0.1.0
 * @category guards
 */
export const isSkipped = (u: unknown): u is SkippedQueryAtom<unknown, unknown> =>
  Atom.isAtom(u) && TypeId in u && "skipped" in u;

/**
 * Defines a parameterised query. Instances are memoised per argument (compared
 * structurally), so `todoQuery({ page: 1 })` returns the same atom each call.
 *
 * @since 0.1.0
 * @category constructors
 */
export const make: {
  // With a stream, the stream's services are needed too. These are separate
  // overloads so that a query without one keeps its `R` when the call is
  // typed by its context (an argument of `fetchQuery`, say).
  <Arg, A, E = never, R = never, U = never, SE = never, SR = never>(
    definition: Definition<Arg, A, E, R, U, SE, SR> & {
      readonly initialData: (arg: Arg) => A;
      readonly stream: StreamFamilyDefinition<Arg, A, U, SE, SR> | undefined;
    },
  ): QueryFamily<Arg, A, E, R | SR, DefinedQueryAtom<A, E, R | SR>>;
  <Arg, A, E = never, R = never, U = never, SE = never, SR = never>(
    definition: Definition<Arg, A, E, R, U, SE, SR> & {
      readonly stream: StreamFamilyDefinition<Arg, A, U, SE, SR> | undefined;
    },
  ): QueryFamily<Arg, A, E, R | SR>;
  <Arg, A, E = never, R = never>(
    definition: Definition<Arg, A, E, R> & { readonly initialData: (arg: Arg) => A },
  ): QueryFamily<Arg, A, E, R, DefinedQueryAtom<A, E, R>>;
  <Arg, A, E = never, R = never>(definition: Definition<Arg, A, E, R>): QueryFamily<Arg, A, E, R>;
  // A definition held in a variable of the definition type: whether it has a
  // stream or initial data is not known.
  <Arg, A, E = never, R = never, U = never, SE = never, SR = never>(
    definition: Definition<Arg, A, E, R, U, SE, SR>,
  ): QueryFamily<Arg, A, E, R | SR>;
} = (<Arg, A, E = never, R = never>(
  definition: Definition<Arg, A, E, R, any, any, R>,
): QueryFamily<Arg, A, E, R> => {
  const { key, run, enabled, initialData, initialDataUpdatedAt, persist, stream, ...options } =
    definition;
  const codec = persist === undefined ? undefined : persistCodec(persist.schema);
  const instance = Atom.family((arg: Arg) =>
    makeAtom<A, E, R>({
      key: key(arg) as QueryKey.Tagged<A, E>,
      run: run(arg),
      options: { ...options, enabled: typeof enabled === "function" ? enabled(arg) : enabled },
      initialData:
        initialData === undefined
          ? undefined
          : {
              data: () => initialData(arg),
              updatedAt:
                initialDataUpdatedAt === undefined ? undefined : () => initialDataUpdatedAt(arg),
            },
      persist: codec,
      stream: stream === undefined ? undefined : { ...stream, updates: stream.updates(arg) },
    }),
  );
  const skipped = makeSkipped<A, E>();
  const family = (arg: Arg | SkipToken) => (arg === skipToken ? skipped : instance(arg));
  return Object.assign(family, {
    key: (arg: Arg) => key(arg) as QueryKey.Tagged<A, E>,
  }) as QueryFamily<Arg, A, E, R>;
}) as typeof make;

/**
 * Defines a query without arguments.
 *
 * @since 0.1.0
 * @category constructors
 */
export const single: {
  // Separate overloads for a stream: see `make`.
  <A, E = never, R = never, U = never, SE = never, SR = never>(
    definition: SingleDefinition<A, E, R, U, SE, SR> & {
      readonly initialData: () => A;
      readonly stream: StreamDefinition<A, U, SE, SR> | undefined;
    },
  ): DefinedQueryAtom<A, E, R | SR>;
  <A, E = never, R = never, U = never, SE = never, SR = never>(
    definition: SingleDefinition<A, E, R, U, SE, SR> & {
      readonly stream: StreamDefinition<A, U, SE, SR> | undefined;
    },
  ): QueryAtom<A, E, R | SR>;
  <A, E = never, R = never>(
    definition: SingleDefinition<A, E, R> & { readonly initialData: () => A },
  ): DefinedQueryAtom<A, E, R>;
  <A, E = never, R = never>(definition: SingleDefinition<A, E, R>): QueryAtom<A, E, R>;
  // A definition held in a variable of the definition type: see `make`.
  <A, E = never, R = never, U = never, SE = never, SR = never>(
    definition: SingleDefinition<A, E, R, U, SE, SR>,
  ): QueryAtom<A, E, R | SR>;
} = (<A, E = never, R = never>(
  definition: SingleDefinition<A, E, R, any, any, R>,
): QueryAtom<A, E, R> => {
  const { key, run, initialData, initialDataUpdatedAt, persist, stream, ...options } = definition;
  return makeAtom({
    persist: persist === undefined ? undefined : persistCodec(persist.schema),
    stream,
    key: key as QueryKey.Tagged<A, E>,
    run,
    options,
    initialData:
      initialData === undefined
        ? undefined
        : { data: initialData, updatedAt: initialDataUpdatedAt },
  });
}) as typeof single;

/**
 * TanStack-style alias for {@link single}, to ease porting (D1).
 *
 * @since 0.1.0
 * @category constructors
 */
export const queryOptions = single;

/**
 * `placeholderData` helper that keeps showing the previous key's data while
 * the new key loads (TanStack's `keepPreviousData`).
 *
 * @since 0.1.0
 * @category placeholders
 */
export const keepPreviousData = <A>(previous: Option.Option<A>): Option.Option<A> => previous;

/**
 * Builds a query atom from a full descriptor. With `write`, the atom is
 * writable (infinite queries accept page directions).
 * @internal
 */
export const makeAtom = <A, E, R, W = never, Extra extends object = {}>(
  descriptor: {
    readonly key: QueryKey.Tagged<A, E>;
    readonly run: Effect.Effect<A, E, R>;
    readonly options: QueryOptions<E>;
    readonly initialData: InitialData<A> | undefined;
    readonly behavior?: QueryDescriptor<A, E, R>["behavior"];
    readonly persist?: QueryDescriptor<A, E, R>["persist"];
    readonly stream?: QueryDescriptor<A, E, R>["stream"];
  },
  extra?: {
    readonly fields?: Extra | undefined;
    readonly write?: ((entry: QueryEntry<A, E>, value: W) => void) | undefined;
  },
): QueryAtom<A, E, R> & Extra => {
  // Refreshing the query atom refreshes this atom instead, in the registry
  // that was asked to. Its rebuild forces a refetch with that registry's
  // client (one atom can be mounted in several registries, each with its own).
  const refetch = Atom.readable((get): true => {
    // A previous value means this is a rebuild, i.e. a refresh.
    if (Option.isSome(get.self<true>())) {
      QueryClient.fromAtomContext(get).cache.build<A, E>(self).fetch({ cancelRefetch: true });
    }
    return true;
  });
  const read = (get: Atom.AtomContext): QueryResult.QueryResult<A, E> => {
    const client = QueryClient.fromAtomContext(get);
    // The client is shut down: creating an entry now would fetch on a closed
    // runtime. Keep showing the last result, if any.
    if (client.cache.isDisposed) {
      return Option.getOrElse(get.self<QueryResult.QueryResult<A, E>>(), () =>
        QueryResult.disabled<A, E>(AsyncResult.initial()),
      );
    }
    const entry = client.cache.build<A, E>(self);
    // Keeps `refetch` (and its previous value) alive while this atom is
    // mounted. Its value never changes, so it never rebuilds this atom.
    get(refetch);
    const fetchedAtMount = entry.fetchCount;
    const observer = entry.addObserver();
    const unsubscribe = entry.subscribe(() => {
      // The entry was removed from the cache: rebuild against a fresh one,
      // unless the client is shutting down (the cache removes every entry).
      if (entry.isRemoved) {
        if (client.cache.isDisposed) {
          get.setSelf(entry.toResult({ fetchedAtMount }));
        } else {
          get.refreshSelf();
        }
      } else {
        get.setSelf(entry.toResult({ fetchedAtMount }));
      }
    });
    get.addFinalizer(() => {
      unsubscribe();
      observer.release();
    });
    return entry.toResult({ fetchedAtMount });
  };
  const refresh = (f: <T>(atom: Atom.Atom<T>) => void) => f(refetch);
  const write = extra?.write;
  const atom =
    write === undefined
      ? Atom.readable(read, refresh)
      : Atom.writable<QueryResult.QueryResult<A, E>, W>(
          read,
          (ctx, value) => write(QueryClient.fromAtomContext(ctx).cache.build<A, E>(self), value),
          refresh,
        );
  const self: QueryAtom<A, E, R> & Extra = Object.assign(atom, {
    [TypeId]: TypeId,
    key: descriptor.key,
    run: descriptor.run,
    options: descriptor.options,
    initialData: descriptor.initialData,
    behavior: descriptor.behavior,
    persist: descriptor.persist,
    stream: descriptor.stream,
    ...(extra?.fields ?? ({} as Extra)),
  } as const) as unknown as QueryAtom<A, E, R> & Extra;
  return self;
};

/** @internal */
export const makeSkipped = <A, E>(): SkippedQueryAtom<A, E> =>
  Object.assign(
    Atom.readable(() => QueryResult.disabled<A, E>(AsyncResult.initial())),
    { [TypeId]: TypeId, skipped: true } as const,
  );
