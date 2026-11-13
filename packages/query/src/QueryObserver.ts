/**
 * A framework-agnostic observer of one query, with per-observer options.
 * Framework bindings (`useQuery`) create one per component.
 *
 * Query atoms are shared by every reader, so they cannot carry per-reader
 * options. The observer adds them:
 *
 * - `enabled` / `refetchOnMount` that override the definition,
 * - `select` (memoised, structurally shared),
 * - `placeholderData` (including `Query.keepPreviousData` across key changes),
 * - `isFetchedAfterMount` relative to this observer's mount,
 * - an optimistic result for the first render, before the observer is attached.
 *
 * @since 0.1.0
 */
import { Option } from "effect";
import { AsyncResult } from "effect/reactivity";
import type {
  ObserveOptions,
  ObserverHandle,
  QueryEntry,
  RefetchInterval,
} from "./internal/queryEntry.ts";
import { replaceEqualDeep } from "./internal/structuralSharing.ts";
import * as Query from "./Query.ts";
import type * as QueryClient from "./QueryClient.ts";
import * as QueryResult from "./QueryResult.ts";

/**
 * Placeholder shown while a query is `pending`: a value, or a function of the
 * data this observer last showed (possibly for a previous key).
 *
 * @since 0.1.0
 * @category models
 */
export type PlaceholderData<A> = A | ((previous: Option.Option<A>) => Option.Option<A>);

/**
 * @since 0.1.0
 * @category models
 */
export interface Options<A, B = A> {
  /** Overrides the definition's `enabled`. */
  readonly enabled?: boolean | undefined;
  /** Overrides the definition's `refetchOnMount`. */
  readonly refetchOnMount?: boolean | "always" | undefined;
  /** Overrides the definition's `refetchOnWindowFocus`. */
  readonly refetchOnWindowFocus?: boolean | "always" | undefined;
  /** Overrides the definition's `refetchOnReconnect`. */
  readonly refetchOnReconnect?: boolean | "always" | undefined;
  /** Poll while this observer is mounted. */
  readonly refetchInterval?: RefetchInterval<any> | undefined;
  readonly refetchIntervalInBackground?: boolean | undefined;
  /** Overrides the definition's `retryOnMount`. */
  readonly retryOnMount?: boolean | undefined;
  /** Derive the data this observer sees. Does not change the cache. Keep it referentially stable. */
  readonly select?: ((data: A) => B) | undefined;
  readonly placeholderData?: PlaceholderData<A> | undefined;
}

/**
 * Anything an observer can watch.
 *
 * @since 0.1.0
 * @category models
 */
export type Observable<A, E> = Query.QueryAtom<A, E, any> | Query.SkippedQueryAtom<A, E>;

/**
 * @since 0.1.0
 * @category models
 */
export class QueryObserver<A, E, B = A> {
  private readonly client: QueryClient.Service;
  private query: Observable<A, E>;
  private options: Options<A, B>;

  private readonly listeners = new Set<() => void>();
  private entry: QueryEntry<A, E> | undefined;
  private detachEntry: (() => void) | undefined;
  private handle: ObserverHandle | undefined;
  private fetchedAtMount = 0;

  /** Last non-placeholder raw data shown, for `keepPreviousData`. */
  private previousData: Option.Option<A> = Option.none();
  private selectMemo:
    | { readonly fn: (a: A) => B; readonly input: A; readonly output: B }
    | undefined;
  private resultMemo:
    | { readonly deps: ReadonlyArray<unknown>; readonly result: QueryResult.QueryResult<B, E> }
    | undefined;

  /** Bumped on every change; a cheap snapshot for `useSyncExternalStore`. */
  version = 0;

  constructor(client: QueryClient.Service, query: Observable<A, E>, options: Options<A, B> = {}) {
    this.client = client;
    this.query = query;
    this.options = options;
  }

  // -- subscription ---------------------------------------------------------

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    if (this.listeners.size === 1) this.attach();
    return () => {
      this.listeners.delete(listener);
      if (this.listeners.size === 0) this.detach();
    };
  }

  private notify(): void {
    this.version++;
    for (const listener of Array.from(this.listeners)) listener();
  }

  private attach(): void {
    if (!Query.isQueryAtom(this.query)) return;
    const entry = this.client.cache.build<A, E>(this.query);
    this.entry = entry;
    this.fetchedAtMount = entry.fetchCount;
    const unsubscribe = entry.subscribe(() => {
      if (Option.isSome(entry.state.data)) this.previousData = entry.state.data;
      if (entry.isRemoved) {
        // Removed from the cache while observed: start over on a fresh entry.
        this.detach();
        if (this.listeners.size > 0) this.attach();
      }
      this.notify();
    });
    const handle = entry.addObserver(observeOptions(this.options));
    this.handle = handle;
    this.detachEntry = () => {
      unsubscribe();
      handle.release();
    };
  }

  private detach(): void {
    this.detachEntry?.();
    this.detachEntry = undefined;
    this.handle = undefined;
    this.entry = undefined;
  }

  // -- options --------------------------------------------------------------

  /**
   * Apply new inputs. Call after commit (e.g. in an effect), not during render.
   * Switching query re-attaches; enabling a disabled observer fetches if needed.
   */
  setOptions(query: Observable<A, E>, options: Options<A, B> = {}): void {
    const previousQuery = this.query;
    const wasEnabled = this.isEnabled();
    this.query = query;
    this.options = options;
    if (this.listeners.size === 0) return;
    if (previousQuery !== query) {
      this.detach();
      this.attach();
      this.notify();
    } else {
      this.handle?.update(observeOptions(options));
      if (
        !wasEnabled &&
        this.isEnabled() &&
        this.entry?.shouldFetchOnMount(observeOptions(options))
      ) {
        this.entry.fetch();
      }
    }
  }

  private isEnabled(): boolean {
    if (!Query.isQueryAtom(this.query)) return false;
    return this.options.enabled ?? this.query.options.enabled ?? true;
  }

  // -- results --------------------------------------------------------------

  /** The result for the applied options. */
  getCurrentResult(): QueryResult.QueryResult<B, E> {
    return this.getOptimisticResult(this.query, this.options);
  }

  /**
   * The result for `query` / `options` as if they were applied and mounted:
   * a fetch that mounting would start is already shown as `fetching`. Pure
   * apart from creating the cache entry, so it is safe to call during render.
   */
  getOptimisticResult(
    query: Observable<A, E>,
    options: Options<A, B> = {},
  ): QueryResult.QueryResult<B, E> {
    if (!Query.isQueryAtom(query)) {
      return this.memo([query, options.select, options.placeholderData], () =>
        this.applyPlaceholderAndSelect(QueryResult.disabled<A, E>(AsyncResult.initial()), options),
      );
    }
    const entry = this.client.cache.build<A, E>(query);
    const mounted = this.entry === entry;
    const optimisticFetch = !mounted && entry.shouldFetchOnMount(observeOptions(options));
    const enabled = options.enabled ?? entry.options.enabled;
    const fetchedAtMount = mounted ? this.fetchedAtMount : entry.fetchCount;
    const isStale = entry.isStale();
    const usesPrevious = typeof options.placeholderData === "function";
    return this.memo(
      [
        query,
        entry.state,
        isStale,
        enabled,
        optimisticFetch,
        fetchedAtMount,
        options.select,
        options.placeholderData,
        usesPrevious ? this.previousData : undefined,
      ],
      () => {
        const raw = entry.toResult({ fetchedAtMount, optimisticFetch, enabled });
        if (Option.isSome(raw.data)) this.previousData = raw.data;
        return this.applyPlaceholderAndSelect(raw, options);
      },
    );
  }

  /** Force a refetch (joins nothing; supersedes a running fetch when data exists). */
  refetch(): void {
    if (!Query.isQueryAtom(this.query)) return;
    (this.entry ?? this.client.cache.build<A, E>(this.query)).fetch({ cancelRefetch: true });
  }

  private memo(
    deps: ReadonlyArray<unknown>,
    compute: () => QueryResult.QueryResult<B, E>,
  ): QueryResult.QueryResult<B, E> {
    const memo = this.resultMemo;
    if (
      memo !== undefined &&
      memo.deps.length === deps.length &&
      memo.deps.every((d, i) => d === deps[i])
    ) {
      return memo.result;
    }
    const result = compute();
    this.resultMemo = { deps, result };
    return result;
  }

  private applyPlaceholderAndSelect(
    raw: QueryResult.QueryResult<A, E>,
    options: Options<A, B>,
  ): QueryResult.QueryResult<B, E> {
    let result: QueryResult.QueryResult<A, E> = raw;
    if (raw.status === "pending" && options.placeholderData !== undefined) {
      const placeholder =
        typeof options.placeholderData === "function"
          ? (options.placeholderData as (previous: Option.Option<A>) => Option.Option<A>)(
              this.previousData,
            )
          : Option.some(options.placeholderData);
      if (Option.isSome(placeholder)) result = asPlaceholder(raw, placeholder.value);
    }
    const select = options.select;
    if (select === undefined) return result as unknown as QueryResult.QueryResult<B, E>;
    return QueryResult.map(result, (a) => this.select(select, a));
  }

  private select(fn: (a: A) => B, input: A): B {
    const memo = this.selectMemo;
    if (memo !== undefined && memo.fn === fn && memo.input === input) return memo.output;
    const next = fn(input);
    const output = memo === undefined ? next : replaceEqualDeep(memo.output, next);
    this.selectMemo = { fn, input, output };
    return output;
  }
}

const observeOptions = (options: Options<any, any>): ObserveOptions => ({
  enabled: options.enabled,
  refetchOnMount: options.refetchOnMount,
  refetchOnWindowFocus: options.refetchOnWindowFocus,
  refetchOnReconnect: options.refetchOnReconnect,
  refetchInterval: options.refetchInterval,
  refetchIntervalInBackground: options.refetchIntervalInBackground,
  retryOnMount: options.retryOnMount,
});

/**
 * @since 0.1.0
 * @category constructors
 */
export const make = <A, E, B = A>(
  client: QueryClient.Service,
  query: Observable<A, E>,
  options?: Options<A, B>,
): QueryObserver<A, E, B> => new QueryObserver(client, query, options);

const asPlaceholder = <A, E>(
  base: QueryResult.Pending<A, E>,
  data: A,
): QueryResult.Success<A, E> => ({
  ...base,
  result: AsyncResult.success<A, E>(data, { waiting: base.isFetching }),
  status: "success",
  isPending: false,
  isSuccess: true,
  isError: false,
  isLoading: false,
  isRefetching: base.isFetching,
  isLoadingError: false,
  isRefetchError: false,
  isPlaceholderData: true,
  data: Option.some(data) as Option.Some<A>,
  error: Option.none() as Option.None<E>,
});

/**
 * One entry of a {@link QueriesObserver}.
 *
 * @since 0.1.0
 * @category models
 */
export interface QueriesInput<A = any, E = any, B = any> {
  readonly query: Observable<A, E>;
  readonly options?: Options<A, B> | undefined;
}

/**
 * Observes a list of queries (for `useQueries`). Observers are matched by
 * index; the list may grow or shrink between `setQueries` calls.
 *
 * @since 0.1.0
 * @category models
 */
export class QueriesObserver {
  private readonly client: QueryClient.Service;
  private observers: Array<QueryObserver<any, any, any>> = [];
  private subscriptions: Array<() => void> = [];
  private readonly listeners = new Set<() => void>();
  version = 0;

  constructor(client: QueryClient.Service, inputs: ReadonlyArray<QueriesInput>) {
    this.client = client;
    this.ensure(inputs);
  }

  private readonly onChange = () => {
    this.version++;
    for (const listener of Array.from(this.listeners)) listener();
  };

  private ensure(inputs: ReadonlyArray<QueriesInput>): void {
    for (let i = this.observers.length; i < inputs.length; i++) {
      const input = inputs[i]!;
      this.observers.push(new QueryObserver(this.client, input.query, input.options));
    }
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    if (this.listeners.size === 1) {
      this.subscriptions = this.observers.map((observer) => observer.subscribe(this.onChange));
    }
    return () => {
      this.listeners.delete(listener);
      if (this.listeners.size === 0) {
        for (const unsubscribe of this.subscriptions) unsubscribe();
        this.subscriptions = [];
      }
    };
  }

  /** Apply new inputs. Call after commit. */
  setQueries(inputs: ReadonlyArray<QueriesInput>): void {
    const active = this.listeners.size > 0;
    const previousLength = this.observers.length;
    for (let i = inputs.length; i < this.observers.length; i++) this.subscriptions[i]?.();
    this.observers = this.observers.slice(0, inputs.length);
    this.subscriptions = this.subscriptions.slice(0, inputs.length);
    this.ensure(inputs);
    inputs.forEach((input, i) => {
      const observer = this.observers[i]!;
      if (active && this.subscriptions[i] === undefined) {
        this.subscriptions[i] = observer.subscribe(this.onChange);
      }
      observer.setOptions(input.query, input.options);
    });
    if (previousLength !== inputs.length) this.onChange();
  }

  /** Results as if `inputs` were applied; safe during render. */
  getOptimisticResults(
    inputs: ReadonlyArray<QueriesInput>,
  ): ReadonlyArray<QueryResult.QueryResult<any, any>> {
    this.ensure(inputs);
    return inputs.map((input, i) =>
      this.observers[i]!.getOptimisticResult(input.query, input.options),
    );
  }

  refetch(index: number): void {
    this.observers[index]?.refetch();
  }
}
