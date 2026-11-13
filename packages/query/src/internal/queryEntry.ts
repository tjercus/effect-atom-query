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
import { AsyncResult, type Reactivity } from "effect/reactivity";
import type * as FocusManager from "../FocusManager.ts";
import type * as OnlineManager from "../OnlineManager.ts";
import * as QueryKey from "../QueryKey.ts";
import type * as QueryResult from "../QueryResult.ts";
import { replaceEqualDeep } from "./structuralSharing.ts";

// ---------------------------------------------------------------------------
// options
// ---------------------------------------------------------------------------

/** @internal */
export type StaleTime = Duration.Input | "static";

/** @internal */
export type RetryOption<E> = boolean | number | Schedule.Schedule<unknown, E>;

/**
 * How fetches react to connectivity:
 * - `online` (default): fetches and retries wait while offline (`fetchStatus: "paused"`).
 * - `always`: ignore connectivity; `refetchOnReconnect` defaults to `false`.
 * - `offlineFirst`: run the first attempt regardless; pause retries while offline.
 * @internal
 */
export type NetworkMode = "online" | "always" | "offlineFirst";

/** @internal */
export type RefetchInterval<E> =
  | Duration.Input
  | false
  | ((result: QueryResult.QueryResult<any, E>) => Duration.Input | false);

/** Keys in Effect's `Reactivity` service (as used by `AtomHttpApi`, `AtomRpc`, `Reactivity.mutation`). @internal */
export type ReactivityKeys =
  | ReadonlyArray<unknown>
  | Readonly<Record<string, ReadonlyArray<unknown>>>;

/** @internal */
export interface QueryOptions<E> {
  readonly staleTime?: StaleTime | undefined;
  readonly gcTime?: Duration.Input | undefined;
  readonly retry?: RetryOption<E> | undefined;
  readonly refetchOnMount?: boolean | "always" | undefined;
  /** Refetch active stale queries when the window regains focus. Default `true`. */
  readonly refetchOnWindowFocus?: boolean | "always" | undefined;
  /** Refetch active stale queries on reconnect. Default `true` (`false` for `networkMode: "always"`). */
  readonly refetchOnReconnect?: boolean | "always" | undefined;
  /** Poll while observed. Recomputed from the result after every fetch when a function. */
  readonly refetchInterval?: RefetchInterval<E> | undefined;
  /** Keep polling while the window is unfocused. Default `false`. */
  readonly refetchIntervalInBackground?: boolean | undefined;
  readonly networkMode?: NetworkMode | undefined;
  /** Fetch on mount when the query has errored and has no data. Default `true`. */
  readonly retryOnMount?: boolean | undefined;
  readonly enabled?: boolean | undefined;
  /**
   * Invalidate (and refetch, when active) this query whenever these keys are
   * invalidated in Effect's `Reactivity` service, if the client has one.
   */
  readonly reactivityKeys?: ReactivityKeys | undefined;
  /** Free-form metadata, available to filters' predicates. */
  readonly meta?: Readonly<Record<string, unknown>> | undefined;
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
  readonly refetchOnWindowFocus: boolean | "always";
  readonly refetchOnReconnect: boolean | "always";
  readonly refetchInterval: RefetchInterval<E>;
  readonly refetchIntervalInBackground: boolean;
  readonly networkMode: NetworkMode;
  readonly retryOnMount: boolean;
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
  const networkMode = options.networkMode ?? defaults.networkMode ?? "online";
  return {
    staleTime: staleTime === "static" ? "static" : Duration.fromInputUnsafe(staleTime),
    gcTime: Duration.fromInputUnsafe(options.gcTime ?? defaults.gcTime ?? "5 minutes"),
    retry: resolveRetry(options.retry ?? (defaults.retry as RetryOption<E> | undefined) ?? 3),
    refetchOnMount: options.refetchOnMount ?? defaults.refetchOnMount ?? true,
    refetchOnWindowFocus: options.refetchOnWindowFocus ?? defaults.refetchOnWindowFocus ?? true,
    refetchOnReconnect:
      options.refetchOnReconnect ?? defaults.refetchOnReconnect ?? networkMode !== "always",
    refetchInterval:
      options.refetchInterval ??
      (defaults.refetchInterval as RefetchInterval<E> | undefined) ??
      false,
    refetchIntervalInBackground:
      options.refetchIntervalInBackground ?? defaults.refetchIntervalInBackground ?? false,
    networkMode,
    retryOnMount: options.retryOnMount ?? defaults.retryOnMount ?? true,
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
  /**
   * Replaces `run` with a function of the current data and the requested
   * direction (used by infinite queries).
   */
  readonly behavior?: ((context: BehaviorContext<A>) => Effect.Effect<A, E, R>) | undefined;
  /** Present when the query opted into persistence. */
  readonly persist?: PersistCodec<A> | undefined;
}

/**
 * JSON codec of a persisted query's data (derived from its `Schema`).
 * @internal
 */
export interface PersistCodec<A> {
  readonly encode: (data: A) => unknown;
  readonly decode: (json: unknown) => A;
}

/** A persisted query waiting to be claimed by its query atom. @internal */
export interface PreloadedQuery {
  readonly queryKey: unknown;
  readonly data: unknown;
  readonly dataUpdatedAt: number;
}

/** Whether a persister is restoring; mounts do not fetch meanwhile. @internal */
export interface RestoringState {
  readonly isRestoring: () => boolean;
  readonly subscribe: (listener: () => void) => () => void;
  readonly start: () => void;
  /** Ends restoring: entries claim restored data and run held-back mount fetches. */
  readonly finish: () => void;
}

/** @internal */
export type FetchDirection = "forward" | "backward";

/** @internal */
export interface BehaviorContext<A> {
  readonly data: Option.Option<A>;
  readonly direction: FetchDirection | undefined;
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
  readonly refetchOnWindowFocus?: boolean | "always" | undefined;
  readonly refetchOnReconnect?: boolean | "always" | undefined;
  readonly refetchInterval?: RefetchInterval<any> | undefined;
  readonly refetchIntervalInBackground?: boolean | undefined;
  readonly retryOnMount?: boolean | undefined;
  /** This observer's notion of staleness for mount / focus / reconnect refetches. */
  readonly staleTime?: StaleTime | undefined;
}

/**
 * A registered observer. `update` swaps its options (e.g. a re-render with a
 * new `refetchInterval`); `release` unregisters it.
 * @internal
 */
export interface ObserverHandle {
  readonly update: (options: ObserveOptions) => void;
  readonly release: () => void;
}

interface ObserverRecord {
  options: ObserveOptions;
  intervalFiber: Fiber.Fiber<void> | undefined;
}

/**
 * What an entry needs from its client.
 * @internal
 */
export interface ClientRuntime {
  /** Client defaults merged with `setQueryDefaults` entries matching `key`. */
  readonly defaultsFor: (key: QueryKey.QueryKey) => QueryOptions<unknown>;
  readonly now: () => number;
  readonly runFork: <A, E>(
    effect: Effect.Effect<A, E, any>,
    context?: Context.Context<any>,
  ) => Fiber.Fiber<A, E>;
  readonly remove: (entry: QueryEntry<any, any>) => void;
  /** Cache-wide change notification (batched by the cache). */
  readonly onChange: () => void;
  readonly focus: FocusManager.Service;
  readonly online: OnlineManager.Service;
  readonly reactivity: Reactivity.Reactivity | undefined;
  readonly restoring: RestoringState;
  /** Restored, not yet claimed queries, by `QueryKey.toJsonKey`. */
  readonly preloaded: Map<string, PreloadedQuery>;
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
  /** Direction of the running (or last) fetch, for infinite queries. */
  readonly fetchDirection: FetchDirection | undefined;
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
  fetchDirection: undefined,
};

/** @internal */
export interface FetchOptions<E> {
  /** Interrupt a running fetch and start a new one. Defaults to `false` (join it). */
  readonly cancelRefetch?: boolean | undefined;
  /** Extra services to run the fetch with, merged over the client context. */
  readonly context?: Context.Context<any> | undefined;
  /** Override the entry's retry policy for this fetch. */
  readonly retry?: RetryOption<E> | undefined;
  /** For infinite queries: fetch the next / previous page instead of refetching all. */
  readonly direction?: FetchDirection | undefined;
}

/** @internal */
export interface CancelOptions {
  /** Restore the state from before the fetch started. Default `true`. */
  readonly revert?: boolean | undefined;
}

// ---------------------------------------------------------------------------
// entry
// ---------------------------------------------------------------------------

/** @internal */
export class QueryEntry<A, E> {
  state: QueryState<A, E> = initialState;
  options: ResolvedOptions<E>;

  private readonly records = new Set<ObserverRecord>();
  private readonly listeners = new Set<() => void>();
  private fetchId = 0;
  /** State before the running fetch started, for `cancel({ revert: true })`. */
  private revertState: QueryState<A, E> | undefined;
  private revertOnInterrupt = false;
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
    this.options = resolveOptions(runtime.defaultsFor(key), descriptor.options);
    this.state = this.initialStateOf(descriptor);
    this.claimPersisted();
    this.registerReactivity();
    // Entries nobody observes (e.g. built during a render that never committed) are collected.
    this.scheduleGc();
  }

  /** Latest definition wins (it may close over newer values). */
  setDescriptor(descriptor: QueryDescriptor<A, E, any>): void {
    if (descriptor === this.descriptor) return;
    this.descriptor = descriptor;
    this.refreshOptions();
    this.claimPersisted();
    if (this.unregisterReactivity === undefined) this.registerReactivity();
  }

  /**
   * Adopt restored data for this key, if the query is persisted and has no
   * data yet. Undecodable data (e.g. after a schema change) is dropped.
   */
  claimPersisted(): void {
    const codec = this.descriptor.persist;
    if (codec === undefined || Option.isSome(this.state.data)) return;
    const jsonKey = QueryKey.toJsonKey(this.key);
    const preloaded = this.runtime.preloaded.get(jsonKey);
    if (preloaded === undefined) return;
    this.runtime.preloaded.delete(jsonKey);
    let data: A;
    try {
      data = codec.decode(preloaded.data);
    } catch {
      return;
    }
    this.setState((s) => ({
      ...s,
      status: "success",
      data: Option.some(data),
      dataUpdatedAt: preloaded.dataUpdatedAt,
      cause: Option.none(),
    }));
  }

  /** Restoring finished: claim data, then do the mount fetches that were held back. */
  onRestored(): void {
    this.claimPersisted();
    if (this.state.fetchStatus !== "idle") return;
    for (const record of this.records) {
      if (this.shouldFetchOnMount(record.options)) {
        this.fetch();
        return;
      }
    }
  }

  /** Re-resolve options, e.g. after `setQueryDefaults`. */
  refreshOptions(): void {
    this.options = resolveOptions(this.runtime.defaultsFor(this.key), this.descriptor.options);
  }

  private initialStateOf(descriptor: QueryDescriptor<A, E, any>): QueryState<A, E> {
    if (descriptor.initialData === undefined) return initialState;
    return {
      ...initialState,
      status: "success",
      data: Option.some(descriptor.initialData.data()),
      dataUpdatedAt: descriptor.initialData.updatedAt?.() ?? this.runtime.now(),
    };
  }

  private unregisterReactivity: (() => void) | undefined;

  private registerReactivity(): void {
    const keys = this.descriptor.options.reactivityKeys;
    const reactivity = this.runtime.reactivity;
    if (keys === undefined || reactivity === undefined) return;
    this.unregisterReactivity = reactivity.registerUnsafe(keys, () => {
      this.invalidate();
      if (this.isActive && !this.isDisabled && this.options.staleTime !== "static") {
        this.fetch({ cancelRefetch: true });
      }
    });
  }

  // -- imperative updates (QueryClient) -------------------------------------

  /** Mark stale regardless of `staleTime` (except `"static"`). */
  invalidate(): void {
    if (this.state.isInvalidated) return;
    this.cancelStaleTimer();
    this.setState((s) => ({ ...s, isInvalidated: true }));
  }

  /** Write data directly (`setQueryData`). Keeps a running fetch running. */
  setData(data: A, updatedAt: number = this.runtime.now()): void {
    this.cancelStaleTimer();
    this.setState((s) => ({
      ...s,
      status: "success",
      data: this.shareData(s.data, data),
      dataUpdatedAt: updatedAt,
      dataUpdateCount: s.dataUpdateCount + 1,
      cause: Option.none(),
      isInvalidated: false,
    }));
    this.scheduleStaleTimer();
  }

  /** Back to the initial state (`initialData` if any), dropping a running fetch. */
  reset(): void {
    this.fetchFiber?.interruptUnsafe();
    this.fetchFiber = undefined;
    this.fetchId++;
    this.revertState = undefined;
    this.cancelStaleTimer();
    this.setState(() => this.initialStateOf(this.descriptor));
  }

  /**
   * TanStack's `isDisabled`: with observers, all of them are disabled;
   * without, the query never fetched (nothing to refetch).
   */
  get isDisabled(): boolean {
    if (this.records.size > 0) return !this.isActive;
    return this.fetchCount === 0 && this.state.dataUpdatedAt === 0;
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

  get observers(): number {
    return this.records.size;
  }

  /** Has at least one enabled observer. */
  get isActive(): boolean {
    for (const record of this.records) if (this.isEnabledFor(record.options)) return true;
    return false;
  }

  /** Registers an observer. Fetches on mount when appropriate. */
  addObserver(options: ObserveOptions = {}): ObserverHandle {
    const record: ObserverRecord = { options, intervalFiber: undefined };
    this.records.add(record);
    this.cancelGc();
    if (this.shouldFetchOnMount(options)) this.fetch();
    this.scheduleInterval(record);
    let released = false;
    return {
      update: (next) => {
        if (released) return;
        const before = record.options;
        record.options = next;
        if (
          before.refetchInterval !== next.refetchInterval ||
          before.refetchIntervalInBackground !== next.refetchIntervalInBackground ||
          before.enabled !== next.enabled
        ) {
          this.scheduleInterval(record);
        }
      },
      release: () => {
        if (released) return;
        released = true;
        this.clearInterval(record);
        this.records.delete(record);
        if (this.records.size === 0) this.scheduleGc();
      },
    };
  }

  private isEnabledFor(options: ObserveOptions): boolean {
    return options.enabled ?? this.options.enabled;
  }

  /** `true` / `"always"` / `false` trigger semantics shared by mount, focus and reconnect. */
  private shouldRefetchOn(mode: boolean | "always", observer: ObserveOptions = {}): boolean {
    const staleTime = this.staleTimeFor(observer);
    if (staleTime === "static") return false;
    return mode === "always" || (mode && this.isStale(staleTime));
  }

  /** An observer's `staleTime` override, resolved. */
  staleTimeFor(observer: ObserveOptions): Duration.Duration | "static" {
    const staleTime = observer.staleTime;
    if (staleTime === undefined) return this.options.staleTime;
    return staleTime === "static" ? "static" : Duration.fromInputUnsafe(staleTime);
  }

  /** The window regained focus: refetch if any enabled observer asks for it. */
  onWindowFocus(): void {
    if (this.state.fetchStatus !== "idle") return;
    for (const record of this.records) {
      if (!this.isEnabledFor(record.options)) continue;
      const mode = record.options.refetchOnWindowFocus ?? this.options.refetchOnWindowFocus;
      if (this.shouldRefetchOn(mode, record.options)) {
        this.fetch();
        return;
      }
    }
  }

  /** The network came back. Paused fetches continue by themselves; this refetches stale data. */
  onReconnect(): void {
    if (this.state.fetchStatus !== "idle") return;
    for (const record of this.records) {
      if (!this.isEnabledFor(record.options)) continue;
      const mode = record.options.refetchOnReconnect ?? this.options.refetchOnReconnect;
      if (this.shouldRefetchOn(mode, record.options)) {
        this.fetch();
        return;
      }
    }
  }

  // -- polling --------------------------------------------------------------

  private scheduleInterval(record: ObserverRecord): void {
    this.clearInterval(record);
    if (this.removed || !this.isEnabledFor(record.options)) return;
    const option = record.options.refetchInterval ?? this.options.refetchInterval;
    const input = typeof option === "function" ? option(this.toResult()) : option;
    if (input === false) return;
    const interval = Duration.fromInputUnsafe(input);
    if (!Duration.isFinite(interval) || Duration.toMillis(interval) <= 0) return;
    const inBackground =
      record.options.refetchIntervalInBackground ?? this.options.refetchIntervalInBackground;
    record.intervalFiber = this.runtime.runFork(
      Effect.sleep(interval).pipe(
        Effect.andThen(
          Effect.sync(() => {
            record.intervalFiber = undefined;
            if (!this.records.has(record)) return;
            if (inBackground || this.runtime.focus.isFocused()) {
              // The fetch's exit reschedules every observer's interval.
              this.fetch();
            } else {
              this.scheduleInterval(record);
            }
          }),
        ),
      ),
    );
  }

  private clearInterval(record: ObserverRecord): void {
    record.intervalFiber?.interruptUnsafe();
    record.intervalFiber = undefined;
  }

  /** Whether an observer mounting now would start a fetch. */
  shouldFetchOnMount(options: ObserveOptions = {}): boolean {
    if (!this.isEnabledFor(options)) return false;
    if (this.runtime.restoring.isRestoring()) return false;
    if (this.state.fetchStatus !== "idle") return false;
    if (Option.isNone(this.state.data)) {
      const retryOnMount = options.retryOnMount ?? this.options.retryOnMount;
      return !(this.state.status === "error" && !retryOnMount);
    }
    return this.shouldRefetchOn(options.refetchOnMount ?? this.options.refetchOnMount, options);
  }

  /** Whether a fetch could run right now, given `networkMode` and connectivity. */
  get canFetch(): boolean {
    return this.options.networkMode !== "online" || this.runtime.online.isOnline();
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

  /** A fetch is running (not paused). */
  get isFetching(): boolean {
    return this.state.fetchStatus === "fetching";
  }

  /** Interrupt the running fetch, if any. Resolves once it has stopped. */
  cancel(options?: CancelOptions): Fiber.Fiber<A, E> | undefined {
    const fiber = this.fetchFiber;
    if (fiber === undefined) return undefined;
    this.revertOnInterrupt = options?.revert ?? true;
    fiber.interruptUnsafe();
    return fiber;
  }

  private setFetchStatus(id: number, fetchStatus: QueryResult.FetchStatus): void {
    if (id !== this.fetchId || this.state.fetchStatus === fetchStatus) return;
    this.setState((s) => ({ ...s, fetchStatus }));
  }

  /** Waits until online, showing `fetchStatus: "paused"` meanwhile. */
  private pauseWhileOffline(id: number): Effect.Effect<void> {
    return Effect.suspend(() => {
      if (this.runtime.online.isOnline()) return Effect.void;
      this.setFetchStatus(id, "paused");
      return Effect.callback<void>((resume) => {
        const unsubscribe = this.runtime.online.subscribe((online) => {
          if (!online) return;
          unsubscribe();
          resume(Effect.void);
        });
        return Effect.sync(unsubscribe);
      }).pipe(Effect.andThen(Effect.sync(() => this.setFetchStatus(id, "fetching"))));
    });
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
    this.revertState = this.state;
    this.revertOnInterrupt = false;
    this.setState((s) => ({
      ...s,
      fetchStatus: "fetching",
      failureCount: 0,
      failureReason: Option.none(),
      fetchDirection: options?.direction,
    }));

    const { networkMode } = this.options;
    const behavior = this.descriptor.behavior;
    const run = behavior
      ? Effect.suspend(() => behavior({ data: this.state.data, direction: options?.direction }))
      : this.descriptor.run;
    let attemptNumber = 0;
    const attempt = Effect.suspend(() => {
      const n = attemptNumber++;
      const pause = networkMode === "online" || (networkMode === "offlineFirst" && n > 0);
      return pause ? Effect.andThen(this.pauseWhileOffline(id), run) : run;
    }).pipe(
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
      // Cancelled: back to the state before the fetch (`revert`), or keep progress.
      const revertTo = this.revertOnInterrupt ? this.revertState : undefined;
      this.setState((s) => ({ ...(revertTo ?? s), fetchStatus: "idle" }));
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

    this.revertState = undefined;
    this.revertOnInterrupt = false;
    for (const record of this.records) this.scheduleInterval(record);
    if (this.records.size === 0) this.scheduleGc();
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
            if (this.records.size === 0 && this.fetchFiber === undefined) this.runtime.remove(this);
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
    for (const record of this.records) this.clearInterval(record);
    this.unregisterReactivity?.();
    this.unregisterReactivity = undefined;
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
    readonly staleTime?: Duration.Duration | "static" | undefined;
  }): QueryResult.QueryResult<A, E> {
    const state: QueryState<A, E> = meta?.optimisticFetch
      ? { ...this.state, fetchStatus: this.canFetch ? "fetching" : "paused" }
      : this.state;
    return project(state, {
      isStale: this.isStale(meta?.staleTime),
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
