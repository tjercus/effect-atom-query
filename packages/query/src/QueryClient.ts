/**
 * The `QueryClient` service owns the query and mutation caches and runs every
 * fetch and mutation.
 *
 * All imperative methods return `Effect`s (decision D4). Getters return
 * `Option`s (D2).
 *
 * The client captures the context it was built in: query `run` effects that
 * are started by atoms (on mount, focus, polling…) run with those services,
 * plus the `QueryClient` itself, so mutation callbacks can `yield* QueryClient`.
 * Effects started through `fetchQuery`, `mutate` and friends additionally get
 * the caller's services, so their `R` is checked statically.
 *
 * @since 0.1.0
 */
import { Context, Effect, Fiber, Layer, Option, type Scope } from "effect";
import { Atom, AtomRegistry, Reactivity } from "effect/reactivity";
import * as FocusManager from "./FocusManager.ts";
import { type MutationFilters, MutationCache } from "./internal/mutationCache.ts";
import type { MutationKey, MutationOptions } from "./internal/mutationEntry.ts";
import { type QueryFilters, QueryCache } from "./internal/queryCache.ts";
import {
  type CancelOptions,
  type ClientRuntime,
  type QueryDescriptor,
  type QueryEntry,
  type QueryOptions,
  type RetryOption,
  type StaleTime,
  resolveOptions,
} from "./internal/queryEntry.ts";
import type * as Mutation from "./Mutation.ts";
import * as OnlineManager from "./OnlineManager.ts";
import type * as Query from "./Query.ts";
import * as QueryKey from "./QueryKey.ts";
import type * as QueryResult from "./QueryResult.ts";

export type { MutationFilters } from "./internal/mutationCache.ts";
export type { QueryFilters } from "./internal/queryCache.ts";
export type {
  CancelOptions,
  NetworkMode,
  ReactivityKeys,
  RefetchInterval,
} from "./internal/queryEntry.ts";

/**
 * Defaults applied to every query / mutation of a client.
 *
 * @since 0.1.0
 * @category models
 */
export interface DefaultOptions {
  readonly queries?: QueryOptions<unknown> | undefined;
  readonly mutations?: MutationOptions<any, any, any, any, any> | undefined;
}

/**
 * @since 0.1.0
 * @category models
 */
export interface Options {
  readonly defaultOptions?: DefaultOptions | undefined;
}

/**
 * Options for {@link Service.fetchQuery}.
 *
 * @since 0.1.0
 * @category models
 */
export interface FetchQueryOptions<E> {
  /** Return cached data if it is younger than this. Defaults to the query's staleTime. */
  readonly staleTime?: StaleTime | undefined;
  /** Defaults to `false` (no retries), as in TanStack. */
  readonly retry?: RetryOption<E> | undefined;
}

/**
 * @since 0.1.0
 * @category models
 */
export interface InvalidateOptions {
  /** Which matching queries to refetch. Default `"active"`. */
  readonly refetchType?: "active" | "inactive" | "all" | "none" | undefined;
  /** Supersede running fetches (when they have data). Default `true`. */
  readonly cancelRefetch?: boolean | undefined;
}

/**
 * @since 0.1.0
 * @category models
 */
export interface RefetchOptions {
  /** Supersede running fetches (when they have data). Default `true`. */
  readonly cancelRefetch?: boolean | undefined;
}

/**
 * A new value, or a function from the current data to the new data. A
 * function returning `None` leaves the cache untouched.
 *
 * @since 0.1.0
 * @category models
 */
export type Updater<A> = A | ((previous: Option.Option<A>) => Option.Option<A>);

/**
 * @since 0.1.0
 * @category models
 */
export interface SetDataOptions {
  /** Epoch millis the data is from. Defaults to now. */
  readonly updatedAt?: number | undefined;
}

type AnyQuery<A, E, R> = Query.QueryAtom<A, E, R>;

/**
 * @since 0.1.0
 * @category models
 */
export interface Service {
  // -- fetching ---------------------------------------------------------------

  /** Fetch and cache a query; resolves with cached data when it is not stale. */
  readonly fetchQuery: <A, E, R>(
    query: AnyQuery<A, E, R>,
    options?: FetchQueryOptions<E>,
  ) => Effect.Effect<A, E, R>;
  /** Like `fetchQuery`, but never fails and returns nothing. */
  readonly prefetchQuery: <A, E, R>(
    query: AnyQuery<A, E, R>,
    options?: FetchQueryOptions<E>,
  ) => Effect.Effect<void, never, R>;
  /** Return cached data when present (stale or not), otherwise fetch it. */
  readonly ensureQueryData: <A, E, R>(
    query: AnyQuery<A, E, R>,
    options?: FetchQueryOptions<E> & { readonly revalidateIfStale?: boolean | undefined },
  ) => Effect.Effect<A, E, R>;

  // -- reading ----------------------------------------------------------------

  readonly getQueryData: {
    <A, E, R>(query: AnyQuery<A, E, R>): Effect.Effect<Option.Option<A>>;
    <K extends QueryKey.QueryKey>(key: K): Effect.Effect<Option.Option<QueryKey.DataOf<K>>>;
  };
  /** Data of every matching query. */
  readonly getQueriesData: <A = unknown>(
    filters?: QueryFilters,
  ) => Effect.Effect<ReadonlyArray<readonly [QueryKey.QueryKey, Option.Option<A>]>>;
  readonly getQueryState: {
    <A, E, R>(
      query: AnyQuery<A, E, R>,
    ): Effect.Effect<Option.Option<QueryResult.QueryResult<A, E>>>;
    <K extends QueryKey.QueryKey>(
      key: K,
    ): Effect.Effect<
      Option.Option<QueryResult.QueryResult<QueryKey.DataOf<K>, QueryKey.ErrorOf<K>>>
    >;
  };
  /** Number of matching queries that are fetching. */
  readonly isFetching: (filters?: QueryFilters) => Effect.Effect<number>;

  // -- writing ----------------------------------------------------------------

  /** Write data into the cache (creating the entry if needed). Returns the data now cached. */
  readonly setQueryData: {
    <A, E, R>(
      query: AnyQuery<A, E, R>,
      updater: Updater<A>,
      options?: SetDataOptions,
    ): Effect.Effect<Option.Option<A>>;
    <K extends QueryKey.QueryKey>(
      key: K,
      updater: Updater<QueryKey.DataOf<K>>,
      options?: SetDataOptions,
    ): Effect.Effect<Option.Option<QueryKey.DataOf<K>>>;
  };
  /** Update every matching query that has an entry. */
  readonly setQueriesData: <A = unknown>(
    filters: QueryFilters,
    updater: (previous: Option.Option<A>) => Option.Option<A>,
    options?: SetDataOptions,
  ) => Effect.Effect<ReadonlyArray<readonly [QueryKey.QueryKey, Option.Option<A>]>>;

  // -- invalidation -----------------------------------------------------------

  /**
   * Mark matching queries stale and refetch the active ones (by default).
   * Completes when those refetches have settled; their failures are ignored.
   */
  readonly invalidateQueries: (
    filters?: QueryFilters,
    options?: InvalidateOptions,
  ) => Effect.Effect<void>;
  /** Refetch matching (enabled, non-static) queries. Completes when they settle. */
  readonly refetchQueries: (
    filters?: QueryFilters,
    options?: RefetchOptions,
  ) => Effect.Effect<void>;
  /** Reset matching queries to their initial state, then refetch the active ones. */
  readonly resetQueries: (filters?: QueryFilters, options?: RefetchOptions) => Effect.Effect<void>;
  /**
   * Interrupt the fetches of matching queries. By default each query goes
   * back to its state from before the fetch (`revert: true`). Completes once
   * the fetches have stopped.
   */
  readonly cancelQueries: (filters?: QueryFilters, options?: CancelOptions) => Effect.Effect<void>;
  /** Remove matching queries from the cache, interrupting their fetches. */
  readonly removeQueries: (filters?: QueryFilters) => Effect.Effect<void>;
  /** Remove every query and mutation. */
  readonly clear: Effect.Effect<void>;

  // -- defaults ---------------------------------------------------------------

  /** Defaults for queries whose key starts with `key`. Later calls win over earlier ones. */
  readonly setQueryDefaults: (
    key: QueryKey.QueryKey,
    options: QueryOptions<unknown>,
  ) => Effect.Effect<void>;
  readonly getQueryDefaults: (key: QueryKey.QueryKey) => Effect.Effect<QueryOptions<unknown>>;
  /** Defaults (including `run`) for mutations whose key starts with `key`. */
  readonly setMutationDefaults: (
    key: MutationKey,
    options: MutationOptions<any, any, any, any, any>,
  ) => Effect.Effect<void>;
  readonly getMutationDefaults: (
    key: MutationKey,
  ) => Effect.Effect<MutationOptions<any, any, any, any, any>>;

  // -- mutations --------------------------------------------------------------

  /** Run a mutation (tracked in the mutation cache) and wait for it. */
  readonly mutate: <I, A, E, R, C>(
    mutation: Mutation.MutationAtom<I, A, E, R, C>,
    input: I,
  ) => Effect.Effect<A, E, R>;
  /** Number of matching mutations that are pending. */
  readonly isMutating: (filters?: MutationFilters) => Effect.Effect<number>;
  /**
   * Run mutations restored from storage (`QueryPersister`). Completes when
   * they have settled. Executions paused by a live offline period continue on
   * reconnect by themselves.
   */
  readonly resumePausedMutations: Effect.Effect<void>;
  /** Whether a `QueryPersister` is restoring the cache. */
  readonly isRestoring: Effect.Effect<boolean>;

  /** @internal Synchronous access used by atoms and framework bindings. */
  readonly cache: QueryCache;
  /** @internal */
  readonly mutationCache: MutationCache;
  /** @internal */
  readonly mutationDefaults: MutationOptions<any, any, any, any, any>;
  /** @internal */
  readonly runtime: ClientRuntime;
}

/**
 * @since 0.1.0
 * @category services
 */
export class QueryClient extends Context.Service<QueryClient, Service>()(
  "@effect-atom-query/query/QueryClient",
) {}

const keyOf = (queryOrKey: AnyQuery<any, any, any> | QueryKey.QueryKey): QueryKey.QueryKey =>
  Array.isArray(queryOrKey)
    ? (queryOrKey as QueryKey.QueryKey)
    : (queryOrKey as AnyQuery<any, any, any>).key;

const descriptorOf = (
  queryOrKey: AnyQuery<any, any, any> | QueryKey.QueryKey,
): QueryDescriptor<any, any, any> =>
  Array.isArray(queryOrKey)
    ? {
        key: queryOrKey as QueryKey.QueryKey,
        run: Effect.die(
          new Error(
            `Query ${JSON.stringify(queryOrKey)} has no \`run\`: it was only written with setQueryData`,
          ),
        ),
        options: {},
      }
    : (queryOrKey as AnyQuery<any, any, any>);

/**
 * Builds a client in the current context. The client's background fibers are
 * interrupted when the scope closes.
 *
 * @since 0.1.0
 * @category constructors
 */
export const make: (options?: Options) => Effect.Effect<Service, never, Scope.Scope> =
  Effect.fnUntraced(function* (options?: Options) {
    let context = yield* Effect.context<never>();
    const clock = yield* Effect.clockWith(Effect.succeed);
    const focus = yield* FocusManager.FocusManager;
    const online = yield* OnlineManager.OnlineManager;
    const reactivity = Context.getOrUndefined(context, Reactivity.Reactivity);

    const cache = new QueryCache();
    const mutationCache = new MutationCache();
    let restoringCount = 0;
    const restoringListeners = new Set<() => void>();
    const notifyRestoring = () => {
      for (const listener of Array.from(restoringListeners)) listener();
    };
    const restoring: ClientRuntime["restoring"] = {
      isRestoring: () => restoringCount > 0,
      subscribe: (listener) => {
        restoringListeners.add(listener);
        return () => {
          restoringListeners.delete(listener);
        };
      },
      start: () => {
        restoringCount++;
        if (restoringCount === 1) notifyRestoring();
      },
      finish: () => {
        if (restoringCount === 0) return;
        restoringCount--;
        if (restoringCount > 0) return;
        for (const entry of cache.all()) entry.onRestored();
        notifyRestoring();
      },
    };
    const clientDefaults = options?.defaultOptions?.queries ?? {};
    const queryDefaults: Array<readonly [QueryKey.QueryKey, QueryOptions<unknown>]> = [];

    const runtime: ClientRuntime = {
      defaultsFor: (key) => {
        let merged: QueryOptions<unknown> = clientDefaults;
        for (const [k, o] of queryDefaults)
          if (QueryKey.matches(key, k)) merged = { ...merged, ...o };
        return merged;
      },
      now: () => clock.currentTimeMillisUnsafe(),
      runFork: (effect, extra) =>
        Effect.runForkWith(extra === undefined ? context : Context.merge(context, extra))(
          effect as Effect.Effect<any, any, never>,
        ),
      remove: (entry) => cache.remove(entry),
      onChange: () => cache.notifyChange(),
      focus,
      online,
      reactivity,
      restoring,
      preloaded: new Map(),
    };
    cache.setRuntime(runtime);

    // -- fetching -------------------------------------------------------------

    const fetchEntry = <A, E, R>(query: AnyQuery<A, E, R>, options?: FetchQueryOptions<E>) =>
      Effect.contextWith((callerContext: Context.Context<R>) => {
        const entry: QueryEntry<A, E> = cache.build(query);
        const staleTime =
          options?.staleTime === undefined
            ? entry.options.staleTime
            : resolveOptions({}, { staleTime: options.staleTime }).staleTime;
        if (Option.isSome(entry.state.data) && !entry.isStale(staleTime)) {
          return Effect.succeed(entry.state.data.value);
        }
        return Fiber.join(entry.fetch({ context: callerContext, retry: options?.retry ?? false }));
      });

    const prefetchQuery: Service["prefetchQuery"] = (query, options) =>
      fetchEntry(query, options).pipe(Effect.ignore({ log: false }));

    const ensureQueryData: Service["ensureQueryData"] = (query, options) =>
      Effect.suspend(() => {
        const entry = cache.build(query);
        if (Option.isNone(entry.state.data)) return fetchEntry(query, options);
        const data = entry.state.data.value;
        if (options?.revalidateIfStale && entry.isStale()) {
          return prefetchQuery(query, { ...options, staleTime: 0 }).pipe(
            Effect.forkDetach,
            Effect.as(data),
          );
        }
        return Effect.succeed(data);
      });

    // -- refetching -----------------------------------------------------------

    const refetchEntries = (
      entries: ReadonlyArray<QueryEntry<any, any>>,
      cancelRefetch: boolean,
    ): Effect.Effect<void> =>
      Effect.suspend(() => {
        const fibers = entries
          .filter((entry) => !entry.isDisabled && entry.options.staleTime !== "static")
          .map((entry) => entry.fetch({ cancelRefetch }));
        return Effect.forEach(fibers, Fiber.await, { discard: true, concurrency: "unbounded" });
      });

    const refetchQueries: Service["refetchQueries"] = (filters, options) =>
      Effect.suspend(() => refetchEntries(cache.findAll(filters), options?.cancelRefetch ?? true));

    const invalidateQueries: Service["invalidateQueries"] = (filters, options) =>
      Effect.suspend(() => {
        const entries = cache.findAll(filters);
        for (const entry of entries) entry.invalidate();
        const refetchType = options?.refetchType ?? "active";
        if (refetchType === "none") return Effect.void;
        const toRefetch = entries.filter((entry) =>
          refetchType === "all"
            ? true
            : refetchType === "active"
              ? entry.isActive
              : !entry.isActive,
        );
        return refetchEntries(toRefetch, options?.cancelRefetch ?? true);
      });

    const resetQueries: Service["resetQueries"] = (filters, options) =>
      Effect.suspend(() => {
        const entries = cache.findAll(filters);
        for (const entry of entries) entry.reset();
        return refetchEntries(
          entries.filter((entry) => entry.isActive),
          options?.cancelRefetch ?? true,
        );
      });

    const cancelQueries: Service["cancelQueries"] = (filters, options) =>
      Effect.suspend(() => {
        const fibers = cache.findAll(filters).flatMap((entry) => {
          const fiber = entry.cancel(options);
          return fiber === undefined ? [] : [fiber];
        });
        return Effect.forEach(fibers, Fiber.interrupt, { discard: true });
      });

    // -- reading / writing ----------------------------------------------------

    const getQueryData = ((queryOrKey: AnyQuery<any, any, any> | QueryKey.QueryKey) =>
      Effect.sync(() =>
        Option.flatMap(cache.get(keyOf(queryOrKey)), (entry) => entry.state.data),
      )) as Service["getQueryData"];

    const getQueriesData: Service["getQueriesData"] = (filters) =>
      Effect.sync(() =>
        cache.findAll(filters).map((entry) => [entry.key, entry.state.data] as const),
      );

    const getQueryState = ((queryOrKey: AnyQuery<any, any, any> | QueryKey.QueryKey) =>
      Effect.sync(() =>
        Option.map(cache.get(keyOf(queryOrKey)), (entry) => entry.toResult()),
      )) as Service["getQueryState"];

    const applyUpdater = <A>(
      entry: QueryEntry<A, any>,
      updater: Updater<A>,
      options?: SetDataOptions,
    ): Option.Option<A> => {
      const next =
        typeof updater === "function"
          ? (updater as (previous: Option.Option<A>) => Option.Option<A>)(entry.state.data)
          : Option.some(updater);
      if (Option.isSome(next)) entry.setData(next.value, options?.updatedAt);
      return entry.state.data;
    };

    const setQueryData = ((
      queryOrKey: AnyQuery<any, any, any> | QueryKey.QueryKey,
      updater: Updater<any>,
      options?: SetDataOptions,
    ) =>
      Effect.sync(() => {
        const existing = cache.get<any, any>(keyOf(queryOrKey));
        const entry =
          Option.isSome(existing) && Array.isArray(queryOrKey)
            ? existing.value
            : cache.build(descriptorOf(queryOrKey));
        return applyUpdater(entry, updater, options);
      })) as Service["setQueryData"];

    const setQueriesData: Service["setQueriesData"] = (filters, updater, options) =>
      Effect.sync(() =>
        cache
          .findAll(filters)
          .map((entry) => [entry.key, applyUpdater(entry, updater, options)] as const),
      );

    const isFetching: Service["isFetching"] = (filters) =>
      Effect.sync(() => cache.findAll(filters).filter((entry) => entry.isFetching).length);

    const removeQueries: Service["removeQueries"] = (filters) =>
      Effect.sync(() => {
        for (const entry of cache.findAll(filters)) cache.remove(entry);
      });

    // -- defaults -------------------------------------------------------------

    const setQueryDefaults: Service["setQueryDefaults"] = (key, defaults) =>
      Effect.sync(() => {
        const index = queryDefaults.findIndex(([k]) => QueryKey.equals(k, key));
        if (index >= 0) queryDefaults.splice(index, 1);
        queryDefaults.push([key, defaults]);
        for (const entry of cache.findAll({ queryKey: key })) entry.refreshOptions();
      });

    const getQueryDefaults: Service["getQueryDefaults"] = (key) =>
      Effect.sync(() => runtime.defaultsFor(key));

    const setMutationDefaults: Service["setMutationDefaults"] = (key, defaults) =>
      Effect.sync(() => mutationCache.setDefaults(key, defaults));

    const getMutationDefaults: Service["getMutationDefaults"] = (key) =>
      Effect.sync(() => mutationCache.defaultsFor(key));

    // -- mutations ------------------------------------------------------------

    const mutationDefaults = options?.defaultOptions?.mutations ?? {};
    mutationCache.setRuntime(runtime, (keys) =>
      Effect.forEach(keys, (queryKey) => invalidateQueries({ queryKey }), {
        discard: true,
        concurrency: "unbounded",
      }),
    );

    const mutate: Service["mutate"] = (mutation, input) =>
      Effect.contextWith((callerContext) => {
        const entry = mutationCache.build({ ...mutationDefaults, ...mutation.options }, mutation);
        return Fiber.join(entry.execute(input, callerContext));
      });

    const isMutating: Service["isMutating"] = (filters) =>
      Effect.sync(() => mutationCache.findAll({ ...filters, status: "pending" }).length);

    const resumePausedMutations: Service["resumePausedMutations"] = Effect.suspend(() => {
      const fibers = mutationCache.all().flatMap((entry) => {
        if (!entry.isAwaitingResume) return [];
        const fiber = entry.resume();
        return fiber === undefined ? [] : [fiber];
      });
      return Effect.forEach(fibers, Fiber.await, { discard: true, concurrency: "unbounded" });
    });

    const service = QueryClient.of({
      fetchQuery: fetchEntry,
      prefetchQuery,
      ensureQueryData,
      getQueryData,
      getQueriesData,
      getQueryState,
      isFetching,
      setQueryData,
      setQueriesData,
      invalidateQueries,
      refetchQueries,
      resetQueries,
      cancelQueries,
      removeQueries,
      clear: Effect.sync(() => {
        cache.clear();
        mutationCache.clear();
      }),
      setQueryDefaults,
      getQueryDefaults,
      setMutationDefaults,
      getMutationDefaults,
      mutate,
      isMutating,
      resumePausedMutations,
      isRestoring: Effect.sync(() => restoring.isRestoring()),
      cache,
      mutationCache,
      mutationDefaults,
      runtime,
    });
    // Fibers run with the client available, e.g. for mutation callbacks.
    context = Context.add(context, QueryClient, service);

    // Like TanStack's `QueryClient.mount()`: listen while the client lives.
    const unsubscribeFocus = focus.subscribe((focused) => {
      if (focused) for (const entry of cache.all()) entry.onWindowFocus();
    });
    const unsubscribeOnline = online.subscribe((isOnline) => {
      if (isOnline) for (const entry of cache.all()) entry.onReconnect();
    });
    yield* Effect.addFinalizer(() =>
      Effect.sync(() => {
        unsubscribeFocus();
        unsubscribeOnline();
        cache.clear();
        mutationCache.clear();
      }),
    );

    return service;
  });

/**
 * A layer that builds the client with whatever services are provided to it:
 * `QueryClient.layer().pipe(Layer.provide(AppLayer))`.
 *
 * @since 0.1.0
 * @category layers
 */
export const layer = (options?: Options): Layer.Layer<QueryClient> =>
  Layer.effect(QueryClient, make(options));

/**
 * Raised when a query atom is read in an `AtomRegistry` that has no client.
 *
 * @since 0.1.0
 * @category errors
 */
export class MissingQueryClientError extends Error {
  constructor() {
    super(
      "No QueryClient in this AtomRegistry. Provide one with `QueryClient.layerRegistry`, " +
        "`AtomRegistry.make({ initialValues: [QueryClient.initialValue(client)] })` or <QueryClientProvider>.",
    );
    this.name = "MissingQueryClientError";
  }
}

/**
 * The client a registry's query atoms use. Bind it through registry initial
 * values (see {@link initialValue}) or `registry.set(current, Option.some(client))`.
 *
 * @since 0.1.0
 * @category atoms
 */
export const current: Atom.Writable<Option.Option<Service>> = Atom.make(
  Option.none<Service>(),
).pipe(Atom.keepAlive, Atom.withLabel("QueryClient.current"));

/**
 * An `AtomRegistry` initial-value entry that binds `client` to {@link current}.
 *
 * @since 0.1.0
 * @category atoms
 */
export const initialValue = (
  client: Service,
): readonly [Atom.Atom<Option.Option<Service>>, Option.Option<Service>] => [
  current,
  Option.some(client),
];

/**
 * Reads the bound client inside an atom (or a write context), throwing
 * {@link MissingQueryClientError} when none is bound.
 *
 * @since 0.1.0
 * @category atoms
 */
export const fromAtomContext = (get: { get<A>(atom: Atom.Atom<A>): A }): Service => {
  const client = get.get(current);
  if (Option.isNone(client)) throw new MissingQueryClientError();
  return client.value;
};

/**
 * An `AtomRegistry` bound to the `QueryClient` in context.
 *
 * @since 0.1.0
 * @category layers
 */
export const layerRegistry: Layer.Layer<AtomRegistry.AtomRegistry, never, QueryClient> =
  Layer.unwrap(
    Effect.map(QueryClient, (client: Service) =>
      AtomRegistry.layerOptions({ initialValues: [initialValue(client)] }),
    ),
  );
