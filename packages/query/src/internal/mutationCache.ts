import { Semaphore } from "effect";
import * as QueryKey from "../QueryKey.ts";
import type * as MutationResult from "../MutationResult.ts";
import {
  type MutationKey,
  MutationEntry,
  type MutationOptions,
  type MutationRuntime,
} from "./mutationEntry.ts";
import type { ClientRuntime } from "./queryEntry.ts";

/**
 * Selects mutations, as in TanStack Query.
 *
 * @since 0.1.0
 * @category models
 */
export interface MutationFilters {
  /** Prefix match unless `exact` is set. */
  readonly mutationKey?: MutationKey | undefined;
  readonly exact?: boolean | undefined;
  readonly status?: MutationResult.Status | undefined;
  /** Only executions of this mutation atom. */
  readonly mutation?: unknown;
  readonly predicate?: ((mutation: MutationEntry<any, any, any, any>) => boolean) | undefined;
}

/** @internal */
export class MutationCache {
  private readonly entries = new Set<MutationEntry<any, any, any, any>>();
  private readonly scopes = new Map<
    string,
    { readonly semaphore: Semaphore.Semaphore; running: number }
  >();
  private readonly listeners = new Set<() => void>();
  private readonly defaults: Array<
    readonly [MutationKey, MutationOptions<any, any, any, any, any>]
  > = [];
  private notifyScheduled = false;
  private runtime!: MutationRuntime;
  /** `defaultOptions.mutations` of the client. */
  private clientDefaults: MutationOptions<any, any, any, any, any> = {};

  setRuntime(
    client: ClientRuntime,
    invalidate: MutationRuntime["invalidate"],
    clientDefaults: MutationOptions<any, any, any, any, any> = {},
  ): void {
    this.clientDefaults = clientDefaults;
    this.runtime = {
      client,
      invalidate,
      scope: (id) => {
        let scope = this.scopes.get(id);
        if (scope === undefined) {
          scope = { semaphore: Semaphore.makeUnsafe(1), running: 0 };
          this.scopes.set(id, scope);
        }
        return scope;
      },
      // Forget idle scopes, so per-input scope ids do not accumulate.
      releaseScope: (id) => {
        if (this.scopes.get(id)?.running === 0) {
          this.scopes.delete(id);
        }
      },
      onChange: () => this.notifyChange(),
      remove: (entry) => this.remove(entry),
    };
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  notifyChange(): void {
    if (this.notifyScheduled || this.listeners.size === 0) {
      return;
    }
    this.notifyScheduled = true;
    queueMicrotask(() => {
      this.notifyScheduled = false;
      for (const listener of Array.from(this.listeners)) {
        listener();
      }
    });
  }

  setDefaults(key: MutationKey, options: MutationOptions<any, any, any, any, any>): void {
    const index = this.defaults.findIndex(([k]) => keyEquals(k, key));
    if (index >= 0) {
      this.defaults[index] = [key, options];
    } else {
      this.defaults.push([key, options]);
    }
  }

  /** Defaults of every `setMutationDefaults` key that prefix-matches `key`, merged in order. */
  defaultsFor(key: MutationKey | undefined): MutationOptions<any, any, any, any, any> {
    if (key === undefined) {
      return {};
    }
    let merged: MutationOptions<any, any, any, any, any> = {};
    for (const [k, options] of this.defaults) {
      if (keyMatches(key, k)) {
        merged = { ...merged, ...options };
      }
    }
    return merged;
  }

  build<I, A, E, C>(
    options: MutationOptions<I, A, E, any, C>,
    source?: unknown,
  ): MutationEntry<I, A, E, C> {
    // client-wide defaults < `setMutationDefaults` (by key) < the definition
    const merged = {
      ...this.clientDefaults,
      ...withoutUndefined(this.defaultsFor(options.key)),
      ...withoutUndefined(options),
    };
    const entry = new MutationEntry<I, A, E, C>(merged, this.runtime, source);
    this.entries.add(entry);
    this.notifyChange();
    return entry;
  }

  /** Re-create a paused execution from storage (see `QueryPersister`). */
  restore(
    key: MutationKey,
    variables: unknown,
    submittedAt: number,
  ): MutationEntry<any, any, any, any> {
    const entry = this.build({ key });
    entry.restore(variables, submittedAt);
    return entry;
  }

  /** Forget an execution. One that is still running finishes by itself. */
  remove(
    entry: MutationEntry<any, any, any, any>,
    options?: { readonly interrupt?: boolean | undefined },
  ): void {
    this.entries.delete(entry);
    entry.dispose(options);
    this.notifyChange();
  }

  all(): ReadonlyArray<MutationEntry<any, any, any, any>> {
    return Array.from(this.entries);
  }

  findAll(filters: MutationFilters = {}): ReadonlyArray<MutationEntry<any, any, any, any>> {
    return this.all().filter((entry) => matchMutation(filters, entry));
  }

  clear(): void {
    for (const entry of this.all()) {
      this.remove(entry);
    }
  }

  /** The client is shutting down: forget everything and interrupt what is running. */
  dispose(): void {
    for (const entry of this.all()) {
      this.remove(entry, { interrupt: true });
    }
  }
}

const withoutUndefined = <T extends object>(o: T): Partial<T> =>
  Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined)) as Partial<T>;

const asQueryKey = (key: MutationKey): QueryKey.QueryKey => key as unknown as QueryKey.QueryKey;
const keyEquals = (a: MutationKey, b: MutationKey) => QueryKey.equals(asQueryKey(a), asQueryKey(b));
const keyMatches = (key: MutationKey, partial: MutationKey) =>
  QueryKey.matches(asQueryKey(key), asQueryKey(partial));

/** @internal */
export const matchMutation = (
  filters: MutationFilters,
  entry: MutationEntry<any, any, any, any>,
): boolean => {
  const { mutationKey, exact, status, mutation, predicate } = filters;
  if (mutation !== undefined && entry.source !== mutation) {
    return false;
  }
  if (mutationKey !== undefined) {
    if (entry.key === undefined) {
      return false;
    }
    if (exact ? !keyEquals(entry.key, mutationKey) : !keyMatches(entry.key, mutationKey)) {
      return false;
    }
  }
  if (status !== undefined && entry.state.status !== status) {
    return false;
  }
  if (predicate !== undefined && !predicate(entry)) {
    return false;
  }
  return true;
};
