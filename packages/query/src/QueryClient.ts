/**
 * The `QueryClient` service owns the query cache and runs every fetch.
 *
 * All imperative methods return `Effect`s (decision D4). Getters return
 * `Option`s (D2).
 *
 * The client captures the context it was built in: query `run` effects that
 * are started by atoms (on mount, on refresh) run with those services. Effects
 * started through `fetchQuery` and friends additionally get the caller's
 * services, so their `R` is checked statically.
 *
 * @since 0.1.0
 */
import { Context, Effect, Fiber, Layer, Option, type Scope } from "effect";
import { Atom, AtomRegistry } from "effect/reactivity";
import { type QueryFilters, QueryCache } from "./internal/queryCache.ts";
import {
  type ClientRuntime,
  type QueryEntry,
  type QueryOptions,
  type RetryOption,
  type StaleTime,
  resolveOptions,
} from "./internal/queryEntry.ts";
import type * as Query from "./Query.ts";
import type * as QueryKey from "./QueryKey.ts";
import type * as QueryResult from "./QueryResult.ts";

export type { QueryFilters } from "./internal/queryCache.ts";

/**
 * Defaults applied to every query of a client.
 *
 * @since 0.1.0
 * @category models
 */
export interface DefaultOptions {
  readonly queries?: QueryOptions<unknown> | undefined;
}

/**
 * @since 0.1.0
 * @category models
 */
export interface Options {
  readonly defaultOptions?: DefaultOptions | undefined;
}

/**
 * Options for {@link QueryClient.fetchQuery}.
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

type AnyQuery<A, E, R> = Query.QueryAtom<A, E, R>;

/**
 * @since 0.1.0
 * @category models
 */
export interface Service {
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
  readonly getQueryData: {
    <A, E, R>(query: AnyQuery<A, E, R>): Effect.Effect<Option.Option<A>>;
    <K extends QueryKey.QueryKey>(key: K): Effect.Effect<Option.Option<QueryKey.DataOf<K>>>;
  };
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
  /** Remove matching queries from the cache, interrupting their fetches. */
  readonly removeQueries: (filters?: QueryFilters) => Effect.Effect<void>;
  /** Remove every query. */
  readonly clear: Effect.Effect<void>;

  /** @internal Synchronous access used by atoms and framework bindings. */
  readonly cache: QueryCache;
  /** @internal */
  readonly runtime: ClientRuntime;
}

/**
 * @since 0.1.0
 * @category services
 */
export class QueryClient extends Context.Service<QueryClient, Service>()(
  "@effect-native-query/query/QueryClient",
) {}

const keyOf = (queryOrKey: AnyQuery<any, any, any> | QueryKey.QueryKey): QueryKey.QueryKey =>
  Array.isArray(queryOrKey)
    ? (queryOrKey as QueryKey.QueryKey)
    : (queryOrKey as AnyQuery<any, any, any>).key;

/**
 * Builds a client in the current context. The client's background fibers are
 * interrupted when the scope closes.
 *
 * @since 0.1.0
 * @category constructors
 */
export const make: (options?: Options) => Effect.Effect<Service, never, Scope.Scope> =
  Effect.fnUntraced(function* (options?: Options) {
    const context = yield* Effect.context<never>();
    const clock = yield* Effect.clockWith(Effect.succeed);
    const cache = new QueryCache();
    const runtime: ClientRuntime = {
      defaults: options?.defaultOptions?.queries ?? {},
      now: () => clock.currentTimeMillisUnsafe(),
      runFork: (effect, extra) =>
        Effect.runForkWith(extra === undefined ? context : Context.merge(context, extra))(
          effect as Effect.Effect<any, any, never>,
        ),
      remove: (entry) => cache.remove(entry),
      onChange: () => cache.notifyChange(),
    };
    cache.setRuntime(runtime);
    yield* Effect.addFinalizer(() => Effect.sync(() => cache.clear()));

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

    const fetchQuery: Service["fetchQuery"] = fetchEntry;

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

    const getQueryData = ((queryOrKey: AnyQuery<any, any, any> | QueryKey.QueryKey) =>
      Effect.sync(() =>
        Option.flatMap(cache.get(keyOf(queryOrKey)), (entry) => entry.state.data),
      )) as Service["getQueryData"];

    const getQueryState = ((queryOrKey: AnyQuery<any, any, any> | QueryKey.QueryKey) =>
      Effect.sync(() =>
        Option.map(cache.get(keyOf(queryOrKey)), (entry) => entry.toResult()),
      )) as Service["getQueryState"];

    const isFetching: Service["isFetching"] = (filters) =>
      Effect.sync(() => cache.findAll(filters).filter((entry) => entry.isFetching).length);

    const removeQueries: Service["removeQueries"] = (filters) =>
      Effect.sync(() => {
        for (const entry of cache.findAll(filters)) cache.remove(entry);
      });

    return QueryClient.of({
      fetchQuery,
      prefetchQuery,
      ensureQueryData,
      getQueryData,
      getQueryState,
      isFetching,
      removeQueries,
      clear: Effect.sync(() => cache.clear()),
      cache,
      runtime,
    });
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
 * Reads the bound client inside an atom, throwing {@link MissingQueryClientError} when none is bound.
 *
 * @since 0.1.0
 * @category atoms
 */
export const fromAtomContext = (get: Atom.AtomContext): Service => {
  const client = get(current);
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
