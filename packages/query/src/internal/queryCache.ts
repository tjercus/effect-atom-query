import { MutableHashMap, Option } from "effect";
import * as QueryKey from "../QueryKey.ts";
import type * as QueryResult from "../QueryResult.ts";
import { type ClientRuntime, type QueryDescriptor, QueryEntry } from "./queryEntry.ts";

/**
 * Selects cache entries, as in TanStack Query.
 *
 * @since 0.1.0
 * @category models
 */
export interface QueryFilters {
  /** Prefix match unless `exact` is set. */
  readonly queryKey?: QueryKey.QueryKey | undefined;
  readonly exact?: boolean | undefined;
  /** `active` = has observers. Defaults to `all`. */
  readonly type?: "all" | "active" | "inactive" | undefined;
  readonly stale?: boolean | undefined;
  readonly fetchStatus?: QueryResult.FetchStatus | undefined;
  readonly predicate?:
    | ((query: {
        readonly key: QueryKey.QueryKey;
        readonly result: QueryResult.QueryResult<unknown, unknown>;
      }) => boolean)
    | undefined;
}

/** @internal */
export class QueryCache {
  private readonly entries = MutableHashMap.empty<QueryKey.QueryKey, QueryEntry<any, any>>();
  private runtime!: ClientRuntime;
  private readonly listeners = new Set<() => void>();
  private notifyScheduled = false;

  /** Wired by the client after construction (the runtime needs `remove`). */
  setRuntime(runtime: ClientRuntime): void {
    this.runtime = runtime;
  }

  /**
   * Listen to any change in the cache (entries added, removed or updated).
   * Notifications are batched on a microtask, so they never fire during a
   * React render.
   */
  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  /** @internal */
  notifyChange(): void {
    if (this.notifyScheduled || this.listeners.size === 0) return;
    this.notifyScheduled = true;
    queueMicrotask(() => {
      this.notifyScheduled = false;
      for (const listener of Array.from(this.listeners)) listener();
    });
  }

  get<A, E>(key: QueryKey.QueryKey): Option.Option<QueryEntry<A, E>> {
    return MutableHashMap.get(this.entries, key);
  }

  build<A, E>(descriptor: QueryDescriptor<A, E, any>): QueryEntry<A, E> {
    const existing = MutableHashMap.get(this.entries, descriptor.key);
    if (Option.isSome(existing)) {
      existing.value.setDescriptor(descriptor);
      return existing.value;
    }
    const entry = new QueryEntry<A, E>(descriptor.key, descriptor, this.runtime);
    MutableHashMap.set(this.entries, descriptor.key, entry);
    this.notifyChange();
    return entry;
  }

  remove(entry: QueryEntry<any, any>): void {
    const current = MutableHashMap.get(this.entries, entry.key);
    if (Option.isSome(current) && current.value === entry) {
      MutableHashMap.remove(this.entries, entry.key);
    }
    entry.dispose();
    this.notifyChange();
  }

  all(): ReadonlyArray<QueryEntry<any, any>> {
    return Array.from(MutableHashMap.values(this.entries));
  }

  findAll(filters: QueryFilters = {}): ReadonlyArray<QueryEntry<any, any>> {
    return this.all().filter((entry) => matchQuery(filters, entry));
  }

  clear(): void {
    for (const entry of this.all()) this.remove(entry);
  }

  private disposed = false;

  /** The client is shutting down: remove everything; observers stop re-attaching. */
  dispose(): void {
    this.disposed = true;
    this.clear();
  }

  get isDisposed(): boolean {
    return this.disposed;
  }
}

/** @internal */
export const matchQuery = (filters: QueryFilters, entry: QueryEntry<any, any>): boolean => {
  const { queryKey, exact, type = "all", stale, fetchStatus, predicate } = filters;
  if (queryKey !== undefined) {
    if (exact ? !QueryKey.equals(entry.key, queryKey) : !QueryKey.matches(entry.key, queryKey))
      return false;
  }
  if (type !== "all" && (type === "active") !== entry.isActive) return false;
  if (stale !== undefined && stale !== entry.isStale()) return false;
  if (fetchStatus !== undefined && fetchStatus !== entry.state.fetchStatus) return false;
  if (predicate !== undefined && !predicate({ key: entry.key, result: entry.toResult() }))
    return false;
  return true;
};
