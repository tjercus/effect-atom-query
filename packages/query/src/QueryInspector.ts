/**
 * Read-only snapshots of a client's query and mutation caches, for devtools
 * and debugging. Snapshots are plain data; actions are Effects on the client.
 *
 * ```ts
 * const unsubscribe = QueryInspector.subscribe(client, () => {
 *   console.table(QueryInspector.queries(client).map((q) => [q.hash, q.status]))
 * })
 * ```
 *
 * @since 0.1.0
 */
import { Cause, Duration, type Effect, Option } from "effect";
import { keyLabel } from "./internal/jsonKey.ts";
import type { QueryEntry } from "./internal/queryEntry.ts";
import type { MutationEntry } from "./internal/mutationEntry.ts";
import type * as MutationResult from "./MutationResult.ts";
import type * as QueryClient from "./QueryClient.ts";
import * as QueryKey from "./QueryKey.ts";
import type * as QueryResult from "./QueryResult.ts";

/**
 * @since 0.1.0
 * @category models
 */
export interface QuerySnapshot {
  /** Unique per cache entry; stable for the entry's lifetime. */
  readonly id: number;
  readonly key: QueryKey.QueryKey;
  /**
   * Canonical JSON of the key, for display and search. Not unique: keys that
   * differ only in `undefined` vs missing properties print alike.
   */
  readonly hash: string;
  readonly status: QueryResult.Status;
  readonly fetchStatus: QueryResult.FetchStatus;
  readonly observers: number;
  readonly isActive: boolean;
  readonly isStale: boolean;
  readonly isDisabled: boolean;
  readonly isInvalidated: boolean;
  readonly data: Option.Option<unknown>;
  /** `Cause.pretty` of the last failure. */
  readonly error: Option.Option<string>;
  /** epoch millis */
  readonly dataUpdatedAt: Option.Option<number>;
  /** epoch millis */
  readonly errorUpdatedAt: Option.Option<number>;
  readonly dataUpdateCount: number;
  readonly failureCount: number;
  /** millis, or `"static"` / `Infinity` */
  readonly staleTime: number | "static";
  /** millis, or `Infinity` */
  readonly gcTime: number;
  /** Declares a `persist` schema. */
  readonly persisted: boolean;
  readonly meta: Option.Option<Readonly<Record<string, unknown>>>;
}

/**
 * @since 0.1.0
 * @category models
 */
export interface MutationSnapshot {
  /** Unique per execution. */
  readonly id: number;
  readonly key: Option.Option<ReadonlyArray<unknown>>;
  readonly status: MutationResult.Status;
  readonly isPaused: boolean;
  readonly variables: Option.Option<unknown>;
  readonly data: Option.Option<unknown>;
  readonly error: Option.Option<string>;
  readonly failureCount: number;
  /** epoch millis */
  readonly submittedAt: Option.Option<number>;
  readonly observers: number;
}

const millis = (d: Duration.Duration): number =>
  Duration.isFinite(d) ? Duration.toMillis(d) : Number.POSITIVE_INFINITY;

const epoch = (n: number): Option.Option<number> => (n > 0 ? Option.some(n) : Option.none());

const snapshotQuery = (entry: QueryEntry<any, any>): QuerySnapshot => {
  const { state, options } = entry;
  return {
    id: entry.id,
    key: entry.key,
    hash: keyLabel(entry.key),
    status: state.status,
    fetchStatus: state.fetchStatus,
    observers: entry.observers,
    isActive: entry.isActive,
    isStale: entry.isStale(),
    isDisabled: entry.isDisabled,
    isInvalidated: state.isInvalidated,
    data: state.data,
    error: Option.map(state.cause, Cause.pretty),
    dataUpdatedAt: epoch(state.dataUpdatedAt),
    errorUpdatedAt: epoch(state.errorUpdatedAt),
    dataUpdateCount: state.dataUpdateCount,
    failureCount: state.failureCount,
    staleTime: options.staleTime === "static" ? "static" : millis(options.staleTime),
    gcTime: millis(options.gcTime),
    persisted: entry.descriptor.persist !== undefined,
    meta: Option.fromNullishOr(entry.descriptor.options.meta),
  };
};

const snapshotMutation = (entry: MutationEntry<any, any, any, any>): MutationSnapshot => {
  const { state } = entry;
  return {
    id: entry.id,
    key: Option.fromNullishOr(entry.key),
    status: state.status,
    isPaused: state.isPaused,
    variables: state.variables,
    data: state.data,
    error: Option.map(state.cause, Cause.pretty),
    failureCount: state.failureCount,
    submittedAt: epoch(state.submittedAt),
    observers: entry.observers,
  };
};

/**
 * All cached queries.
 *
 * @since 0.1.0
 * @category getters
 */
export const queries = (client: QueryClient.Service): ReadonlyArray<QuerySnapshot> =>
  client.cache.all().map(snapshotQuery);

/**
 * All cached mutation executions, oldest first.
 *
 * @since 0.1.0
 * @category getters
 */
export const mutations = (client: QueryClient.Service): ReadonlyArray<MutationSnapshot> =>
  client.mutationCache
    .all()
    .map(snapshotMutation)
    .sort((a, b) => a.id - b.id);

/**
 * Listen to any change in either cache. Notifications are batched on a
 * microtask. Staleness changes with time alone, so poll for it if needed.
 *
 * @since 0.1.0
 * @category subscriptions
 */
export const subscribe = (client: QueryClient.Service, listener: () => void): (() => void) => {
  const a = client.cache.subscribe(listener);
  const b = client.mutationCache.subscribe(listener);
  return () => {
    a();
    b();
  };
};

/**
 * @since 0.1.0
 * @category models
 */
export type Action = "refetch" | "invalidate" | "reset" | "cancel" | "remove";

/**
 * Run a devtools action on the query with exactly this key.
 *
 * @since 0.1.0
 * @category actions
 */
export const action = (
  client: QueryClient.Service,
  key: QueryKey.QueryKey,
  action: Action,
): Effect.Effect<void> => {
  const filters = { queryKey: key, exact: true } as const;
  switch (action) {
    case "refetch":
      return client.refetchQueries(filters);
    case "invalidate":
      return client.invalidateQueries(filters);
    case "reset":
      return client.resetQueries(filters);
    case "cancel":
      return client.cancelQueries(filters);
    case "remove":
      return client.removeQueries(filters);
  }
};

/**
 * Run an Effect on the client's runtime (with its services), fire and forget.
 * For tooling that is not itself Effect-based.
 *
 * @since 0.1.0
 * @category actions
 */
export const run = (client: QueryClient.Service, effect: Effect.Effect<void>): void => {
  client.runtime.runFork(effect);
};
