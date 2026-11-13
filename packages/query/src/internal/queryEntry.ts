/**
 * Cache entry state machine. Internal: the public surface is `QueryClient`,
 * `Query` and `QueryResult`.
 */
import {
  Cause,
  type Context,
  DateTime,
  Duration,
  Effect,
  Equal,
  Exit,
  type Fiber,
  Option,
  Schedule,
} from "effect";
import { AsyncResult } from "effect/reactivity";
import type * as QueryKey from "../QueryKey.ts";
import type * as QueryResult from "../QueryResult.ts";
import { replaceEqualDeep } from "./structuralSharing.ts";

// ---------------------------------------------------------------------------
// options
// ---------------------------------------------------------------------------

/** @internal */
export type StaleTime = Duration.Input | "static";

/** @internal */
export type RetryOption<E> = boolean | number | Schedule.Schedule<unknown, E>;

/** @internal */
export interface QueryOptions<E> {
  readonly staleTime?: StaleTime | undefined;
  readonly gcTime?: Duration.Input | undefined;
  readonly retry?: RetryOption<E> | undefined;
  readonly refetchOnMount?: boolean | "always" | undefined;
  readonly enabled?: boolean | undefined;
  /**
   * Keep references of unchanged parts of new data (`true`, default), replace
   * data wholesale (`false`), or merge with a custom function.
   */
  readonly structuralSharing?:
    | boolean
    | ((oldData: unknown, newData: unknown) => unknown)
    | undefined;
}

/** @internal */
export interface ResolvedOptions<E> {
  readonly staleTime: Duration.Duration | "static";
  readonly gcTime: Duration.Duration;
  readonly retry: Option.Option<Schedule.Schedule<unknown, E>>;
  readonly refetchOnMount: boolean | "always";
  readonly enabled: boolean;
  readonly structuralSharing: boolean | ((oldData: unknown, newData: unknown) => unknown);
}

/**
 * TanStack's default delay: `min(1000 * 2 ** failureCount, 30_000)`.
 * @internal
 */
export const defaultRetryDelay: Schedule.Schedule<Duration.Duration> = Schedule.min([
  Schedule.exponential("1 second"),
  Schedule.spaced("30 seconds"),
]);

/** @internal */
export const resolveRetry = <E>(
  retry: RetryOption<E>,
): Option.Option<Schedule.Schedule<unknown, E>> => {
  if (retry === false || retry === 0) return Option.none();
  if (retry === true) return Option.some(defaultRetryDelay);
  if (typeof retry === "number")
    return Option.some(defaultRetryDelay.pipe(Schedule.upTo({ times: retry })));
  return Option.some(retry);
};

/** @internal */
export const resolveOptions = <E>(
  defaults: QueryOptions<unknown>,
  options: QueryOptions<E>,
): ResolvedOptions<E> => {
  const staleTime = options.staleTime ?? defaults.staleTime ?? 0;
  return {
    staleTime: staleTime === "static" ? "static" : Duration.fromInputUnsafe(staleTime),
    gcTime: Duration.fromInputUnsafe(options.gcTime ?? defaults.gcTime ?? "5 minutes"),
    retry: resolveRetry(options.retry ?? (defaults.retry as RetryOption<E> | undefined) ?? 3),
    refetchOnMount: options.refetchOnMount ?? defaults.refetchOnMount ?? true,
    enabled: options.enabled ?? defaults.enabled ?? true,
    structuralSharing: options.structuralSharing ?? defaults.structuralSharing ?? true,
  };
};

// ---------------------------------------------------------------------------
// descriptor + runtime
// ---------------------------------------------------------------------------

/**
 * Everything needed to run one query instance.
 * @internal
 */
export interface QueryDescriptor<A, E, R> {
  readonly key: QueryKey.Tagged<A, E>;
  readonly run: Effect.Effect<A, E, R>;
  readonly options: QueryOptions<E>;
  readonly initialData?: InitialData<A> | undefined;
}

/**
 * Seeds a new cache entry. Stale by default, unless `updatedAt` plus
 * `staleTime` is still in the future.
 * @internal
 */
export interface InitialData<A> {
  readonly data: () => A;
  readonly updatedAt?: (() => number) | undefined;
}

/**
 * Per-observer overrides of mount behaviour.
 * @internal
 */
export interface ObserveOptions {
  readonly enabled?: boolean | undefined;
  readonly refetchOnMount?: boolean | "always" | undefined;
}

/**
 * What an entry needs from its client.
 * @internal
 */
export interface ClientRuntime {
  readonly defaults: QueryOptions<unknown>;
  readonly now: () => number;
  readonly runFork: <A, E>(
    effect: Effect.Effect<A, E, any>,
    context?: Context.Context<any>,
  ) => Fiber.Fiber<A, E>;
  readonly remove: (entry: QueryEntry<any, any>) => void;
  /** Cache-wide change notification (batched by the cache). */
  readonly onChange: () => void;
}

// ---------------------------------------------------------------------------
// state
// ---------------------------------------------------------------------------

/** @internal */
export interface QueryState<A, E> {
  readonly status: QueryResult.Status;
  readonly fetchStatus: QueryResult.FetchStatus;
  readonly data: Option.Option<A>;
  /** epoch millis; 0 = never */
  readonly dataUpdatedAt: number;
  readonly dataUpdateCount: number;
  readonly cause: Option.Option<Cause.Cause<E>>;
  readonly errorUpdatedAt: number;
  readonly errorUpdateCount: number;
  readonly failureCount: number;
  readonly failureReason: Option.Option<E>;
  readonly isInvalidated: boolean;
}

const initialState: QueryState<never, never> = {
  status: "pending",
  fetchStatus: "idle",
  data: Option.none(),
  dataUpdatedAt: 0,
  dataUpdateCount: 0,
  cause: Option.none(),
  errorUpdatedAt: 0,
  errorUpdateCount: 0,
  failureCount: 0,
  failureReason: Option.none(),
  isInvalidated: false,
};

/** @internal */
export interface FetchOptions<E> {
  /** Interrupt a running fetch and start a new one. Defaults to `false` (join it). */
  readonly cancelRefetch?: boolean | undefined;
  /** Extra services to run the fetch with, merged over the client context. */
  readonly context?: Context.Context<any> | undefined;
  /** Override the entry's retry policy for this fetch. */
  readonly retry?: RetryOption<E> | undefined;
}

// ---------------------------------------------------------------------------
// entry
// ---------------------------------------------------------------------------

/** @internal */
export class QueryEntry<A, E> {
  state: QueryState<A, E> = initialState;
  options: ResolvedOptions<E>;
  observers = 0;

  private readonly listeners = new Set<() => void>();
  private fetchId = 0;
  private fetchFiber: Fiber.Fiber<A, E> | undefined;
  private gcFiber: Fiber.Fiber<void> | undefined;
  private staleFiber: Fiber.Fiber<void> | undefined;
  private removed = false;

  readonly key: QueryKey.QueryKey;
  descriptor: QueryDescriptor<A, E, any>;
  private readonly runtime: ClientRuntime;

  constructor(
    key: QueryKey.QueryKey,
    descriptor: QueryDescriptor<A, E, any>,
    runtime: ClientRuntime,
  ) {
    this.key = key;
    this.descriptor = descriptor;
    this.runtime = runtime;
    this.options = resolveOptions(runtime.defaults, descriptor.options);
    if (descriptor.initialData !== undefined) {
      this.state = {
        ...initialState,
        status: "success",
        data: Option.some(descriptor.initialData.data()),
        dataUpdatedAt: descriptor.initialData.updatedAt?.() ?? runtime.now(),
      };
    }
    // Entries nobody observes (e.g. built during a render that never committed) are collected.
    this.scheduleGc();
  }

  /** Latest definition wins (it may close over newer values). */
  setDescriptor(descriptor: QueryDescriptor<A, E, any>): void {
    if (descriptor === this.descriptor) return;
    this.descriptor = descriptor;
    this.options = resolveOptions(this.runtime.defaults, descriptor.options);
  }

  // -- subscriptions --------------------------------------------------------

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    this.scheduleStaleTimer();
    return () => {
      this.listeners.delete(listener);
      if (this.listeners.size === 0) this.cancelStaleTimer();
    };
  }

  private notify(): void {
    for (const listener of Array.from(this.listeners)) listener();
    this.runtime.onChange();
  }

  private setState(f: (s: QueryState<A, E>) => QueryState<A, E>): void {
    this.state = f(this.state);
    this.notify();
  }

  // -- observers ------------------------------------------------------------

  get isActive(): boolean {
    return this.observers > 0;
  }

  /** Registers an observer. Fetches on mount when appropriate. Returns a release function. */
  addObserver(options?: ObserveOptions): () => void {
    this.observers++;
    this.cancelGc();
    if (this.shouldFetchOnMount(options)) this.fetch();
    let released = false;
    return () => {
      if (released) return;
      released = true;
      this.observers--;
      if (this.observers === 0) this.scheduleGc();
    };
  }

  /** Whether an observer mounting now would start a fetch. */
  shouldFetchOnMount(options?: ObserveOptions): boolean {
    if (!(options?.enabled ?? this.options.enabled)) return false;
    if (this.state.fetchStatus !== "idle") return false;
    if (Option.isNone(this.state.data)) return true;
    const refetchOnMount = options?.refetchOnMount ?? this.options.refetchOnMount;
    if (refetchOnMount === "always") return this.options.staleTime !== "static";
    return refetchOnMount && this.isStale();
  }

  // -- staleness ------------------------------------------------------------

  isStale(staleTime: Duration.Duration | "static" = this.options.staleTime): boolean {
    if (Option.isNone(this.state.data)) return true;
    if (staleTime === "static") return false;
    if (this.state.isInvalidated) return true;
    if (!Duration.isFinite(staleTime)) return false;
    return this.runtime.now() >= this.state.dataUpdatedAt + Duration.toMillis(staleTime);
  }

  private scheduleStaleTimer(): void {
    if (this.staleFiber || this.listeners.size === 0 || Option.isNone(this.state.data)) return;
    const { staleTime } = this.options;
    if (staleTime === "static" || !Duration.isFinite(staleTime) || this.state.isInvalidated) return;
    const remaining = this.state.dataUpdatedAt + Duration.toMillis(staleTime) - this.runtime.now();
    if (remaining <= 0) return;
    this.staleFiber = this.runtime.runFork(
      Effect.sleep(remaining).pipe(
        Effect.andThen(
          Effect.sync(() => {
            this.staleFiber = undefined;
            this.notify();
          }),
        ),
      ),
    );
  }

  private cancelStaleTimer(): void {
    this.staleFiber?.interruptUnsafe();
    this.staleFiber = undefined;
  }

  // -- fetching -------------------------------------------------------------

  get isFetching(): boolean {
    return this.state.fetchStatus !== "idle";
  }

  /**
   * Starts a fetch, or joins the running one (request deduplication). Returns
   * the fiber that settles with this fetch's outcome.
   */
  fetch(options?: FetchOptions<E>): Fiber.Fiber<A, E> {
    if (this.fetchFiber !== undefined) {
      if (!options?.cancelRefetch || Option.isNone(this.state.data)) return this.fetchFiber;
      // Superseded: the new fetch takes over. Its exit is ignored (id mismatch).
      this.fetchFiber.interruptUnsafe();
      this.fetchFiber = undefined;
    }

    const id = ++this.fetchId;
    this.setState((s) => ({
      ...s,
      fetchStatus: "fetching",
      failureCount: 0,
      failureReason: Option.none(),
    }));

    const attempt = this.descriptor.run.pipe(
      Effect.tapError((error) =>
        Effect.sync(() => {
          if (id !== this.fetchId) return;
          this.setState((s) => ({
            ...s,
            failureCount: s.failureCount + 1,
            failureReason: Option.some(error),
          }));
        }),
      ),
    );
    const retry = options?.retry !== undefined ? resolveRetry(options.retry) : this.options.retry;
    const withRetry = Option.isSome(retry) ? attempt.pipe(Effect.retry(retry.value)) : attempt;

    const fiber = this.runtime.runFork(
      withRetry.pipe(Effect.onExit((exit) => Effect.sync(() => this.onFetchExit(id, exit)))),
      options?.context,
    );
    // A synchronous `run` may already have settled inside runFork.
    if (id === this.fetchId && this.state.fetchStatus !== "idle") this.fetchFiber = fiber;
    return fiber;
  }

  private onFetchExit(id: number, exit: Exit.Exit<A, E>): void {
    if (id !== this.fetchId || this.removed) return;
    this.fetchFiber = undefined;
    const now = this.runtime.now();

    if (Exit.isSuccess(exit)) {
      this.cancelStaleTimer();
      this.setState((s) => ({
        ...s,
        status: "success",
        fetchStatus: "idle",
        data: this.shareData(s.data, exit.value),
        dataUpdatedAt: now,
        dataUpdateCount: s.dataUpdateCount + 1,
        cause: Option.none(),
        failureCount: 0,
        failureReason: Option.none(),
        isInvalidated: false,
      }));
      this.scheduleStaleTimer();
    } else if (Cause.hasInterruptsOnly(exit.cause)) {
      // Cancelled: keep the previous data/error, just stop fetching.
      this.setState((s) => ({ ...s, fetchStatus: "idle" }));
    } else {
      this.setState((s) => ({
        ...s,
        status: "error",
        fetchStatus: "idle",
        cause: Option.some(exit.cause),
        errorUpdatedAt: now,
        errorUpdateCount: s.errorUpdateCount + 1,
      }));
    }

    if (this.observers === 0) this.scheduleGc();
  }

  /** Structural sharing: unchanged data keeps its references, so subscribers can skip work. */
  private shareData(previous: Option.Option<A>, next: A): Option.Option<A> {
    if (Option.isNone(previous)) return Option.some(next);
    const { structuralSharing } = this.options;
    if (structuralSharing === false) return Option.some(next);
    if (typeof structuralSharing === "function") {
      return Option.some(structuralSharing(previous.value, next) as A);
    }
    if (Equal.equals(previous.value, next)) return previous;
    const shared = replaceEqualDeep(previous.value, next);
    return shared === previous.value ? previous : Option.some(shared);
  }

  // -- garbage collection ---------------------------------------------------

  private scheduleGc(): void {
    this.cancelGc();
    if (this.removed || !Duration.isFinite(this.options.gcTime)) return;
    this.gcFiber = this.runtime.runFork(
      Effect.sleep(this.options.gcTime).pipe(
        Effect.andThen(
          Effect.sync(() => {
            this.gcFiber = undefined;
            if (this.observers === 0 && this.fetchFiber === undefined) this.runtime.remove(this);
          }),
        ),
      ),
    );
  }

  private cancelGc(): void {
    this.gcFiber?.interruptUnsafe();
    this.gcFiber = undefined;
  }

  get isRemoved(): boolean {
    return this.removed;
  }

  /** Called by the cache when the entry is removed. Listeners are told so they can re-attach. */
  dispose(): void {
    if (this.removed) return;
    this.removed = true;
    this.cancelGc();
    this.cancelStaleTimer();
    this.fetchFiber?.interruptUnsafe();
    this.fetchFiber = undefined;
    this.notify();
  }

  // -- projection -----------------------------------------------------------

  /**
   * The current result. `fetchedAtMount` is `fetchCount` when the observer
   * mounted (for `isFetchedAfterMount`); `optimisticFetch` renders a fetch that
   * is about to start as already fetching.
   */
  toResult(meta?: {
    readonly fetchedAtMount?: number | undefined;
    readonly optimisticFetch?: boolean | undefined;
    readonly enabled?: boolean | undefined;
  }): QueryResult.QueryResult<A, E> {
    const state: QueryState<A, E> = meta?.optimisticFetch
      ? { ...this.state, fetchStatus: "fetching" }
      : this.state;
    return project(state, {
      isStale: this.isStale(),
      isEnabled: meta?.enabled ?? this.options.enabled,
      fetchedAtMount: meta?.fetchedAtMount ?? 0,
    });
  }

  get fetchCount(): number {
    return this.state.dataUpdateCount + this.state.errorUpdateCount;
  }
}

const toDateTime = (millis: number): Option.Option<DateTime.Utc> =>
  millis === 0 ? Option.none() : Option.some(DateTime.makeUnsafe(millis));

/** @internal */
export const project = <A, E>(
  state: QueryState<A, E>,
  meta: {
    readonly isStale: boolean;
    readonly isEnabled: boolean;
    readonly fetchedAtMount: number;
  },
): QueryResult.QueryResult<A, E> => {
  const isFetching = state.fetchStatus === "fetching";
  const base = {
    fetchStatus: state.fetchStatus,
    isFetching,
    isPaused: state.fetchStatus === "paused",
    isStale: meta.isStale,
    isEnabled: meta.isEnabled,
    isFetched: state.dataUpdateCount > 0 || state.errorUpdateCount > 0,
    isFetchedAfterMount: state.dataUpdateCount + state.errorUpdateCount > meta.fetchedAtMount,
    isPlaceholderData: false,
    dataUpdatedAt: toDateTime(state.dataUpdatedAt),
    errorUpdatedAt: toDateTime(state.errorUpdatedAt),
    dataUpdateCount: state.dataUpdateCount,
    errorUpdateCount: state.errorUpdateCount,
    failureCount: state.failureCount,
    failureReason: state.failureReason,
  };
  const previousSuccess = Option.map(state.data, (value) =>
    AsyncResult.success<A, E>(value, { timestamp: state.dataUpdatedAt }),
  );

  if (state.status === "error" && Option.isSome(state.cause)) {
    const cause = state.cause.value;
    return {
      ...base,
      result: AsyncResult.failure<A, E>(cause, { previousSuccess, waiting: isFetching }),
      status: "error",
      isPending: false,
      isSuccess: false,
      isError: true,
      isLoading: false,
      isRefetching: isFetching,
      isLoadingError: Option.isNone(state.data),
      isRefetchError: Option.isSome(state.data),
      data: state.data,
      error: Cause.findErrorOption(cause),
      cause,
    };
  }
  if (state.status === "success" && Option.isSome(state.data)) {
    return {
      ...base,
      result: AsyncResult.success<A, E>(state.data.value, {
        waiting: isFetching,
        timestamp: state.dataUpdatedAt,
      }),
      status: "success",
      isPending: false,
      isSuccess: true,
      isError: false,
      isLoading: false,
      isRefetching: isFetching,
      isLoadingError: false,
      isRefetchError: false,
      data: state.data as Option.Some<A>,
      error: Option.none() as Option.None<E>,
    };
  }
  return {
    ...base,
    result: AsyncResult.initial<A, E>(isFetching),
    status: "pending",
    isPending: true,
    isSuccess: false,
    isError: false,
    isLoading: isFetching,
    isRefetching: false,
    isLoadingError: false,
    isRefetchError: false,
    data: Option.none() as Option.None<A>,
    error: Option.none() as Option.None<E>,
  };
};
