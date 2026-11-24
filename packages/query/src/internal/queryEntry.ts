/**
 * Cache entry state machine. Internal: the public surface is `QueryClient`,
 * `Query` and `QueryResult`.
 */
import {
  Cause,
  Context,
  DateTime,
  Duration,
  Effect,
  Equal,
  Exit,
  Fiber,
  Option,
  Result,
  Schedule,
  Stream,
} from "effect";
import { AsyncResult, type Reactivity } from "effect/reactivity";
import type * as FocusManager from "../FocusManager.ts";
import type * as OnlineManager from "../OnlineManager.ts";
import * as QueryKey from "../QueryKey.ts";
import { jsonKey } from "./jsonKey.ts";
import type { PersistCodec } from "./persistCodec.ts";
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
  /**
   * How long data stays fresh. Default `0`. `"Infinity"` stays fresh until
   * invalidated. `"static"` never goes stale **and is skipped by invalidation,
   * `refetchQueries` and every refetch trigger**: it fetches only when there is
   * no data. For "cached until a mutation invalidates it", use `"Infinity"`.
   */
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
  if (retry === false || retry === 0) {
    return Option.none();
  }
  if (retry === true) {
    return Option.some(defaultRetryDelay);
  }
  if (typeof retry === "number") {
    return Option.some(defaultRetryDelay.pipe(Schedule.upTo({ times: retry })));
  }
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
 * Live updates for a query: a stream of updates and how to apply one to the
 * cached data.
 * @internal
 */
export interface StreamDescriptor<A> {
  readonly updates: Stream.Stream<any, any, any>;
  readonly apply: (data: A, update: any) => A;
  readonly retry?: RetryOption<any> | undefined;
}

/** How long the stream keeps running after the last enabled observer left. @internal */
export const streamGrace: Duration.Duration = Duration.seconds(1);

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
  /** Present when the query has live updates. */
  readonly stream?: StreamDescriptor<A> | undefined;
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
 * Which attempt of a fetch is running: provided to a query's `run` on every
 * attempt. Public as `Query.FetchAttempt`.
 * @internal
 */
export const FetchAttempt: Context.Reference<{ readonly attempt: number }> = Context.Reference<{
  readonly attempt: number;
}>("@effect-atom-query/query/FetchAttempt", { defaultValue: () => ({ attempt: 0 }) });

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
  /** Run in the client's context; aborting `signal` interrupts the fiber. */
  readonly runPromiseExit: <A, E>(
    effect: Effect.Effect<A, E, any>,
    options?: { readonly signal?: AbortSignal | undefined },
  ) => Promise<Exit.Exit<A, E>>;
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
  /**
   * epoch millis when the request that produced `data` started (for a write,
   * the write time). Data reflects every server change made before it.
   */
  readonly dataRequestedAt: number;
  readonly dataUpdateCount: number;
  readonly cause: Option.Option<Cause.Cause<E>>;
  readonly errorUpdatedAt: number;
  readonly errorUpdateCount: number;
  readonly failureCount: number;
  readonly failureReason: Option.Option<E>;
  readonly isInvalidated: boolean;
  /** Direction of the running (or last) fetch, for infinite queries. */
  readonly fetchDirection: FetchDirection | undefined;
  readonly streamStatus: QueryResult.StreamStatus;
  /** The stream's last failure; cleared by the next update. */
  readonly streamError: Option.Option<unknown>;
}

/** @internal */
export const initialState: QueryState<never, never> = {
  status: "pending",
  fetchStatus: "idle",
  data: Option.none(),
  dataUpdatedAt: 0,
  dataRequestedAt: 0,
  dataUpdateCount: 0,
  cause: Option.none(),
  errorUpdatedAt: 0,
  errorUpdateCount: 0,
  failureCount: 0,
  failureReason: Option.none(),
  isInvalidated: false,
  fetchDirection: undefined,
  streamStatus: "idle",
  streamError: Option.none(),
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
let nextEntryId = 0;

/** @internal */
export class QueryEntry<A, E> {
  /** Unique per entry (keys that print alike can still be distinct entries). */
  readonly id = nextEntryId++;
  state: QueryState<A, E> = initialState;
  options: ResolvedOptions<E>;

  private readonly records = new Set<ObserverRecord>();
  private readonly listeners = new Set<() => void>();
  private fetchId = 0;
  /** When the running (or last) fetch started. */
  private fetchStartedAt = 0;
  /** State before the running fetch started, for `cancel({ revert: true })`. */
  private revertState: QueryState<A, E> | undefined;
  private revertOnInterrupt = false;
  private fetchFiber: Fiber.Fiber<A, E> | undefined;
  /** For each superseded fetch, the fetch that replaced it. */
  private readonly successors = new WeakMap<Fiber.Fiber<A, E>, Fiber.Fiber<A, E>>();
  private gcFiber: Fiber.Fiber<void> | undefined;
  private staleFiber: Fiber.Fiber<void> | undefined;
  private removed = false;
  /** `state.data` is still the definition's `initialData` (no fetch, write or restore yet). */
  private showsInitialData = false;
  /** Bumped when the stream starts or stops, so a stopped stream's callbacks are ignored. */
  private streamRun = 0;
  /** The stream was started and not stopped since (it may have ended by itself). */
  private streamStarted = false;
  private streamFiber: Fiber.Fiber<void, unknown> | undefined;
  /** Stops the stream once the grace period after the last observer has passed. */
  private streamStopFiber: Fiber.Fiber<void> | undefined;
  /** Updates received while the current fetch runs, applied again to its result. */
  private streamRecord: Array<unknown> = [];
  /** The latest `apply`, for updates recorded before a definition without a stream took over. */
  private streamApply: StreamDescriptor<A>["apply"] | undefined;
  /**
   * Updates arrive without a hole. `false` from a failure until the first
   * update after it, and once the stream has ended.
   */
  private streamLive = false;
  /**
   * How the data keeps up with the stream, in one rule: the data is current
   * when its snapshot was requested after the last hole in the updates
   * closed. `streamGap` counts the holes that closed: the stream started
   * (everything before it), it delivered again after a failure, or it
   * stopped (everything after it). `coveredGap` is the count at the request
   * that gave the current data, `requestedGap` the count at the last request
   * that was sent, also when it failed.
   */
  private streamGap = 0;
  private coveredGap = 0;
  private requestedGap = 0;
  /** A hole closed for which the observers' `refetchOnMount` does not decide. */
  private snapshotDue = false;
  /** The services of the running fetch, for a fetch that follows it. */
  private fetchContext: Context.Context<any> | undefined;

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
    if (descriptor === this.descriptor) {
      return;
    }
    this.descriptor = descriptor;
    this.refreshOptions();
    this.claimPersisted();
    if (descriptor.stream === undefined || this.streamStarted) {
      // Stop the running stream when the new definition has none, or keep it
      // when it has one again.
      this.syncStream();
    } else if (this.isActive) {
      // A definition with a stream is back while the query is observed.
      // Entries are also built during render, so start it afterwards.
      this.runtime.runFork(
        Effect.andThen(
          Effect.yieldNow,
          Effect.sync(() => {
            // Unless an observer started it meanwhile.
            if (this.syncStream()) {
              this.fetchForObservers();
            }
          }),
        ),
      );
    }
    if (this.unregisterReactivity === undefined) {
      this.registerReactivity();
    }
  }

  /**
   * Adopt restored data for this key, if the query is persisted and has no
   * data yet, or only its `initialData` (restored data came from the server,
   * so it wins). Undecodable data (e.g. after a schema change) is dropped.
   */
  claimPersisted(): void {
    const codec = this.descriptor.persist;
    if (codec === undefined) {
      return;
    }
    if (Option.isSome(this.state.data) && !this.showsInitialData) {
      return;
    }
    const key = jsonKey(this.key);
    if (Result.isFailure(key)) {
      return; // Never persisted, so nothing to claim.
    }
    const preloaded = this.runtime.preloaded.get(key.success);
    if (preloaded === undefined) {
      return;
    }
    this.runtime.preloaded.delete(key.success);
    const decoded = codec.decode(preloaded.data);
    if (Result.isFailure(decoded)) {
      return;
    }
    const data = decoded.success;
    this.showsInitialData = false;
    this.setState((s) => ({
      ...s,
      status: "success",
      data: Option.some(data),
      dataUpdatedAt: preloaded.dataUpdatedAt,
      dataRequestedAt: preloaded.dataUpdatedAt,
      cause: Option.none(),
    }));
  }

  /** Restoring finished: claim data, then do the mount fetches that were held back. */
  onRestored(): void {
    this.claimPersisted();
    // The stream was held back as well.
    this.syncStream();
    this.fetchForObservers();
  }

  /** Re-resolve options, e.g. after `setQueryDefaults`. */
  refreshOptions(): void {
    this.options = resolveOptions(this.runtime.defaultsFor(this.key), this.descriptor.options);
  }

  private initialStateOf(descriptor: QueryDescriptor<A, E, any>): QueryState<A, E> {
    this.showsInitialData = descriptor.initialData !== undefined;
    if (descriptor.initialData === undefined) {
      return initialState;
    }
    return {
      ...initialState,
      status: "success",
      data: Option.some(descriptor.initialData.data()),
      dataUpdatedAt: descriptor.initialData.updatedAt?.() ?? this.runtime.now(),
      dataRequestedAt: descriptor.initialData.updatedAt?.() ?? this.runtime.now(),
    };
  }

  private unregisterReactivity: (() => void) | undefined;

  private registerReactivity(): void {
    const keys = this.descriptor.options.reactivityKeys;
    const reactivity = this.runtime.reactivity;
    if (keys === undefined || reactivity === undefined) {
      return;
    }
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
    if (this.state.isInvalidated) {
      return;
    }
    this.cancelStaleTimer();
    this.setState((s) => ({ ...s, isInvalidated: true }));
  }

  /** Write data directly (`setQueryData`). Keeps a running fetch running. */
  setData(data: A, updatedAt: number = this.runtime.now()): void {
    this.showsInitialData = false;
    this.cancelStaleTimer();
    this.setState((s) => ({
      ...s,
      status: "success",
      data: this.shareData(s.data, data),
      dataUpdatedAt: updatedAt,
      dataRequestedAt: updatedAt,
      dataUpdateCount: s.dataUpdateCount + 1,
      cause: Option.none(),
      // A write does not contain what the stream missed.
      isInvalidated: this.isBehindStream,
    }));
    this.scheduleStaleTimer();
  }

  /** Back to the initial state (`initialData` if any), dropping a running fetch. */
  reset(): void {
    const fiber = this.fetchFiber;
    this.fetchFiber = undefined;
    // Bump first: interrupting runs the old fiber's exit handler synchronously.
    this.fetchId++;
    fiber?.interruptUnsafe();
    this.revertState = undefined;
    this.streamRecord = [];
    this.cancelStaleTimer();
    // A stream that ended or gave up starts over. A running one keeps
    // running, so its fields stay.
    const reopen = this.state.streamStatus === "closed";
    if (reopen) {
      this.interruptStream();
      this.streamStarted = false;
    }
    this.setState((s) => ({
      ...this.initialStateOf(this.descriptor),
      ...(reopen ? {} : { streamStatus: s.streamStatus, streamError: s.streamError }),
    }));
    this.syncStream();
    // The dropped fetch's exit is ignored, so do here what it would have done.
    for (const record of this.records) {
      this.scheduleInterval(record);
    }
    if (this.records.size === 0) {
      this.scheduleGc();
    }
  }

  /**
   * TanStack's `isDisabled`: with observers, all of them are disabled;
   * without, the query never fetched (nothing to refetch).
   */
  get isDisabled(): boolean {
    if (this.records.size > 0) {
      return !this.isActive;
    }
    return this.fetchCount === 0 && this.state.dataUpdatedAt === 0;
  }

  // -- subscriptions --------------------------------------------------------

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    this.scheduleStaleTimer();
    return () => {
      this.listeners.delete(listener);
      if (this.listeners.size === 0) {
        this.cancelStaleTimer();
      }
    };
  }

  private notify(): void {
    for (const listener of Array.from(this.listeners)) {
      listener();
    }
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
    for (const record of this.records) {
      if (this.isEnabledFor(record.options)) {
        return true;
      }
    }
    return false;
  }

  /** Registers an observer. Fetches on mount when appropriate. */
  addObserver(options: ObserveOptions = {}): ObserverHandle {
    const record: ObserverRecord = { options, intervalFiber: undefined };
    this.records.add(record);
    this.cancelGc();
    // Before the fetch, so that its request counts as sent with the stream
    // running. The stream itself connects after this step.
    this.syncStream();
    if (this.shouldFetchOnMount(options)) {
      this.fetch();
    }
    this.scheduleInterval(record);
    let released = false;
    return {
      update: (next) => {
        if (released) {
          return;
        }
        const before = record.options;
        record.options = next;
        if (
          before.refetchInterval !== next.refetchInterval ||
          before.refetchIntervalInBackground !== next.refetchIntervalInBackground ||
          before.enabled !== next.enabled
        ) {
          this.scheduleInterval(record);
        }
        // Also when nothing changed here: the definition may have got a stream.
        if (this.syncStream() && this.shouldFetchOnMount(next)) {
          this.fetch();
        }
      },
      release: () => {
        if (released) {
          return;
        }
        released = true;
        this.clearInterval(record);
        this.records.delete(record);
        this.syncStream();
        if (this.records.size === 0) {
          this.scheduleGc();
        }
      },
    };
  }

  private isEnabledFor(options: ObserveOptions): boolean {
    return options.enabled ?? this.options.enabled;
  }

  /** `true` / `"always"` / `false` trigger semantics shared by mount, focus and reconnect. */
  private shouldRefetchOn(mode: boolean | "always", observer: ObserveOptions = {}): boolean {
    const staleTime = this.staleTimeFor(observer);
    if (staleTime === "static") {
      return false;
    }
    return mode === "always" || (mode && this.isStale(staleTime));
  }

  /** An observer's `staleTime` override, resolved. */
  staleTimeFor(observer: ObserveOptions): Duration.Duration | "static" {
    const staleTime = observer.staleTime;
    if (staleTime === undefined) {
      return this.options.staleTime;
    }
    return staleTime === "static" ? "static" : Duration.fromInputUnsafe(staleTime);
  }

  /** The window regained focus: refetch if any enabled observer asks for it. */
  onWindowFocus(): void {
    if (this.state.fetchStatus !== "idle") {
      return;
    }
    for (const record of this.records) {
      if (!this.isEnabledFor(record.options)) {
        continue;
      }
      const mode = record.options.refetchOnWindowFocus ?? this.options.refetchOnWindowFocus;
      if (this.shouldRefetchOn(mode, record.options)) {
        this.fetch();
        return;
      }
    }
  }

  /** The network came back. Paused fetches continue by themselves; this refetches stale data. */
  onReconnect(): void {
    if (this.state.fetchStatus !== "idle") {
      return;
    }
    for (const record of this.records) {
      if (!this.isEnabledFor(record.options)) {
        continue;
      }
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
    if (this.removed || !this.isEnabledFor(record.options)) {
      return;
    }
    const option = record.options.refetchInterval ?? this.options.refetchInterval;
    const input = typeof option === "function" ? option(this.toResult()) : option;
    if (input === false) {
      return;
    }
    const interval = Duration.fromInputUnsafe(input);
    if (!Duration.isFinite(interval) || Duration.toMillis(interval) <= 0) {
      return;
    }
    const inBackground =
      record.options.refetchIntervalInBackground ?? this.options.refetchIntervalInBackground;
    record.intervalFiber = this.runtime.runFork(
      Effect.sleep(interval).pipe(
        Effect.andThen(
          Effect.sync(() => {
            record.intervalFiber = undefined;
            if (!this.records.has(record)) {
              return;
            }
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
    if (!this.isEnabledFor(options)) {
      return false;
    }
    if (this.runtime.restoring.isRestoring()) {
      return false;
    }
    if (this.state.fetchStatus !== "idle") {
      return false;
    }
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
    if (Option.isNone(this.state.data)) {
      return true;
    }
    if (staleTime === "static") {
      return false;
    }
    if (this.state.isInvalidated) {
      return true;
    }
    if (!Duration.isFinite(staleTime)) {
      return false;
    }
    return this.runtime.now() >= this.state.dataUpdatedAt + Duration.toMillis(staleTime);
  }

  private scheduleStaleTimer(): void {
    if (this.staleFiber || this.listeners.size === 0 || Option.isNone(this.state.data)) {
      return;
    }
    const { staleTime } = this.options;
    if (staleTime === "static" || !Duration.isFinite(staleTime) || this.state.isInvalidated) {
      return;
    }
    const remaining = this.state.dataUpdatedAt + Duration.toMillis(staleTime) - this.runtime.now();
    if (remaining <= 0) {
      return;
    }
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

  /**
   * Wait for `fiber` (a fetch of this entry) to settle, or for the entry to
   * be paused offline, whichever comes first (TanStack resolves refetches of
   * paused queries immediately, so invalidation never hangs offline).
   */
  awaitUnlessPaused(fiber: Fiber.Fiber<A, E>): Effect.Effect<void> {
    if (this.state.fetchStatus === "paused") {
      return Effect.void;
    }
    const paused = Effect.callback<void>((resume) => {
      const unsubscribe = this.subscribe(() => {
        if (this.state.fetchStatus !== "paused") {
          return;
        }
        unsubscribe();
        resume(Effect.void);
      });
      return Effect.sync(unsubscribe);
    });
    // A fetch that was superseded is not done until its successor is.
    const settled = (current: Fiber.Fiber<A, E>): Effect.Effect<void> =>
      Effect.flatMap(Fiber.await(current), () => {
        const successor = this.successors.get(current);
        return successor === undefined ? Effect.void : settled(successor);
      });
    return Effect.raceFirst(settled(fiber), paused);
  }

  /** The fetch that superseded `fiber` (a fetch of this entry), if any. */
  successorOf(fiber: Fiber.Fiber<A, E>): Fiber.Fiber<A, E> | undefined {
    return this.successors.get(fiber);
  }

  /** Interrupt the running fetch, if any. Resolves once it has stopped. */
  cancel(options?: CancelOptions): Fiber.Fiber<A, E> | undefined {
    const fiber = this.fetchFiber;
    if (fiber === undefined) {
      return undefined;
    }
    this.revertOnInterrupt = options?.revert ?? true;
    fiber.interruptUnsafe();
    return fiber;
  }

  private setFetchStatus(id: number, fetchStatus: QueryResult.FetchStatus): void {
    if (id !== this.fetchId || this.state.fetchStatus === fetchStatus) {
      return;
    }
    this.setState((s) => ({ ...s, fetchStatus }));
  }

  /** Waits until online. `onPause` runs first when that takes a wait. */
  private untilOnline(onPause?: () => void): Effect.Effect<void> {
    return Effect.suspend(() => {
      if (this.runtime.online.isOnline()) {
        return Effect.void;
      }
      onPause?.();
      return Effect.callback<void>((resume) => {
        const unsubscribe = this.runtime.online.subscribe((online) => {
          if (!online) {
            return;
          }
          unsubscribe();
          resume(Effect.void);
        });
        return Effect.sync(unsubscribe);
      });
    });
  }

  /** Waits until online, showing `fetchStatus: "paused"` meanwhile. */
  private pauseWhileOffline(id: number): Effect.Effect<void> {
    return this.untilOnline(() => this.setFetchStatus(id, "paused")).pipe(
      Effect.andThen(Effect.sync(() => this.setFetchStatus(id, "fetching"))),
    );
  }

  /**
   * Starts a fetch, or joins the running one (request deduplication). Returns
   * the fiber that settles with this fetch's outcome.
   */
  fetch(options?: FetchOptions<E>): Fiber.Fiber<A, E> {
    let superseded: Fiber.Fiber<A, E> | undefined;
    if (this.fetchFiber !== undefined) {
      if (!options?.cancelRefetch || Option.isNone(this.state.data)) {
        return this.fetchFiber;
      }
      // Superseded: the new fetch takes over. Bump the id before interrupting,
      // since the old fiber's exit handler runs synchronously and must be ignored.
      superseded = this.fetchFiber;
      this.fetchFiber = undefined;
      this.fetchId++;
    }

    const id = ++this.fetchId;
    this.fetchContext = options?.context;
    this.fetchStartedAt = this.runtime.now();
    this.revertState = this.state;
    this.revertOnInterrupt = false;
    this.setState((s) => ({
      ...s,
      // Without data, a (re)fetch after an error is a fresh load (TanStack's
      // fetchState): pending, error cleared. Cancelling reverts to the error.
      ...(Option.isNone(s.data) ? { status: "pending" as const, cause: Option.none() } : {}),
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
      const thisAttempt = Effect.suspend(() => {
        if (id === this.fetchId) {
          // Updates from before this request are part of what it will return,
          // and so is whatever the stream missed before it.
          this.streamRecord = [];
          this.requestedGap = this.streamGap;
          this.snapshotDue = false;
        }
        return Effect.provideService(run, FetchAttempt, { attempt: n });
      });
      return pause ? Effect.andThen(this.pauseWhileOffline(id), thisAttempt) : thisAttempt;
    }).pipe(
      Effect.tapError((error) =>
        Effect.sync(() => {
          if (id !== this.fetchId) {
            return;
          }
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

    // The fiber settles with the data that goes into the cache: the fetched
    // data with the recorded updates applied. Taking the record and writing
    // the data happen in one synchronous step, so no update falls in between.
    let settled = false;
    const settle = (exit: Exit.Exit<A, E>): void => {
      if (!settled) {
        settled = true;
        this.onFetchExit(id, exit);
      }
    };
    const fiber = this.runtime.runFork(
      withRetry.pipe(
        Effect.flatMap((fetched) =>
          Effect.suspend(() => {
            const exit =
              id === this.fetchId ? this.withRecordedUpdates(fetched) : Exit.succeed(fetched);
            settle(exit);
            return exit;
          }),
        ),
        Effect.onExit((exit) => Effect.sync(() => settle(exit))),
      ),
      options?.context,
    );
    if (superseded !== undefined) {
      // Record the successor before interrupting, so whoever waits for the
      // superseded fetch (`fetchQuery`) can follow it.
      this.successors.set(superseded, fiber);
      superseded.interruptUnsafe();
    }
    // A synchronous `run` may already have settled inside runFork.
    if (id === this.fetchId && this.state.fetchStatus !== "idle") {
      this.fetchFiber = fiber;
    }
    return fiber;
  }

  private onFetchExit(id: number, exit: Exit.Exit<A, E>): void {
    if (id !== this.fetchId || this.removed) {
      return;
    }
    this.fetchFiber = undefined;
    const context = this.fetchContext;
    this.fetchContext = undefined;
    // Recorded updates were for this fetch; a success has applied them.
    this.streamRecord = [];
    const now = this.runtime.now();

    if (Exit.isSuccess(exit)) {
      this.coveredGap = this.requestedGap;
      this.showsInitialData = false;
      this.cancelStaleTimer();
      this.setState((s) => ({
        ...s,
        status: "success",
        fetchStatus: "idle",
        data: this.shareData(s.data, exit.value),
        dataUpdatedAt: now,
        dataRequestedAt: this.fetchStartedAt,
        dataUpdateCount: s.dataUpdateCount + 1,
        cause: Option.none(),
        failureCount: 0,
        failureReason: Option.none(),
        // Behind when a hole closed after the request, or is still open.
        isInvalidated: this.isBehindStream,
      }));
      this.scheduleStaleTimer();
    } else if (Cause.hasInterruptsOnly(exit.cause)) {
      // Cancelled: back to the state before the fetch (`revert`), or keep progress.
      const revertTo = this.revertOnInterrupt ? this.revertState : undefined;
      // What the stream missed during the fetch is still missing afterwards.
      this.setState((s) => {
        const base = revertTo ?? s;
        return {
          ...base,
          fetchStatus: "idle",
          isInvalidated: base.isInvalidated || this.isBehindStream,
        };
      });
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
    for (const record of this.records) {
      this.scheduleInterval(record);
    }
    if (this.records.size === 0) {
      this.scheduleGc();
    }
    // Its request may be from before a hole closed: then another one follows.
    // Not after a cancel: whoever cancelled does not want a fetch now (an
    // optimistic write may follow). The data stays stale.
    if (Exit.isSuccess(exit) || !Cause.hasInterruptsOnly(exit.cause)) {
      this.syncSnapshot(context);
    }
  }

  /**
   * The fetched data is a snapshot: updates received while it was fetched may
   * be newer, so they are applied to it again. An `apply` that throws fails
   * the fetch with a defect.
   */
  private withRecordedUpdates(fetched: A): Exit.Exit<A, E> {
    const record = this.streamRecord;
    this.streamRecord = [];
    // Also when a definition without a stream took over meanwhile: the
    // updates were shown, so the fetched data must not lose them.
    const apply = this.descriptor.stream?.apply ?? this.streamApply;
    if (apply === undefined || record.length === 0) {
      return Exit.succeed(fetched);
    }
    const replayed = Result.try(() =>
      record.reduce((data: A, update) => apply(data, update), fetched),
    );
    return Result.isSuccess(replayed) ? Exit.succeed(replayed.success) : Exit.die(replayed.failure);
  }

  /** Structural sharing: unchanged data keeps its references, so subscribers can skip work. */
  private shareData(previous: Option.Option<A>, next: A): Option.Option<A> {
    if (Option.isNone(previous)) {
      return Option.some(next);
    }
    const { structuralSharing } = this.options;
    if (structuralSharing === false) {
      return Option.some(next);
    }
    if (typeof structuralSharing === "function") {
      return Option.some(structuralSharing(previous.value, next) as A);
    }
    if (Equal.equals(previous.value, next)) {
      return previous;
    }
    const shared = replaceEqualDeep(previous.value, next);
    return shared === previous.value ? previous : Option.some(shared);
  }

  // -- stream ---------------------------------------------------------------

  /**
   * Runs the stream while an enabled observer is present, and for a grace
   * period after the last one left (a remount must not reconnect). Called
   * when observers change, never when an entry is merely built. Returns
   * whether it started the stream.
   */
  private syncStream(): boolean {
    if (this.removed) {
      return false;
    }
    const stream = this.descriptor.stream;
    if (!this.streamStarted && this.runtime.restoring.isRestoring()) {
      // Mount fetches are held back while a persister restores, so there is
      // no data and no fetch to give updates to. `onRestored` starts it.
      return false;
    }
    if (stream !== undefined && this.isActive) {
      this.streamStopFiber?.interruptUnsafe();
      this.streamStopFiber = undefined;
      if (!this.streamStarted) {
        this.startStream(stream);
        return true;
      }
    } else if (this.streamStarted && this.streamStopFiber === undefined) {
      this.streamStopFiber = this.runtime.runFork(
        Effect.sleep(streamGrace).pipe(
          Effect.andThen(
            Effect.sync(() => {
              this.streamStopFiber = undefined;
              this.stopStream();
            }),
          ),
        ),
      );
    }
    return false;
  }

  /** Fetches as the mount of the observers that are there would. */
  private fetchForObservers(): void {
    if (this.removed || this.state.fetchStatus !== "idle") {
      return;
    }
    for (const record of this.records) {
      if (this.shouldFetchOnMount(record.options)) {
        this.fetch();
        return;
      }
    }
  }

  private startStream(stream: StreamDescriptor<A>): void {
    const run = ++this.streamRun;
    this.streamStarted = true;
    this.streamLive = true;
    // Whatever was fetched or is being fetched is from before the stream.
    this.streamGap++;
    this.patchStream({ streamStatus: "open", streamError: Option.none() });
    // Only marks the data stale: whoever starts the stream fetches as on a
    // mount, and a fetch that is under way comes back here when it is done.
    this.markBehind();
    // Runs once per attempt: the first start, then each retry.
    const attempt = Stream.unwrap(
      Effect.as(
        this.options.networkMode === "online" ? this.untilOnline() : Effect.void,
        stream.updates,
      ),
    ).pipe(
      Stream.tapError((error) =>
        Effect.sync(() => {
          if (run === this.streamRun) {
            // Updates are missed from here on, so the data is stale. It is
            // refetched once an update shows that the stream works again:
            // refetching on every attempt would fail along with the stream.
            this.streamLive = false;
            this.patchStream({ streamStatus: "reconnecting", streamError: Option.some(error) });
            this.syncSnapshot();
          }
        }),
      ),
    );
    const retry = resolveRetry(stream.retry ?? true);
    const updates = Option.isSome(retry) ? Stream.retry(attempt, retry.value) : attempt;
    // The stream runs after whoever started it is done, so that a fetch
    // started in the same step is there to record its first updates.
    const fiber = this.runtime.runFork(
      Effect.andThen(
        Effect.yieldNow,
        Stream.runForEach(updates, (update) =>
          Effect.sync(() => {
            if (run === this.streamRun) {
              this.onStreamUpdate(update);
            }
          }),
        ),
      ).pipe(
        Effect.onExit((exit) =>
          Effect.sync(() => {
            if (run === this.streamRun) {
              this.onStreamExit(exit);
            }
          }),
        ),
      ),
    );
    this.streamFiber = fiber;
  }

  private onStreamUpdate(update: unknown): void {
    // The latest definition's `apply`, as for the fetch.
    const stream = this.descriptor.stream;
    if (stream === undefined) {
      return;
    }
    this.streamApply = stream.apply;
    // The first update after a failure shows that the stream works again:
    // the hole closes here, and what it swallowed has to be fetched.
    if (!this.streamLive) {
      this.streamLive = true;
      this.streamGap++;
      this.snapshotDue = true;
      // Before this update is handled, so that it is recorded for the fetch.
      this.syncSnapshot();
    }
    const s = this.state;
    if (s.fetchStatus !== "idle") {
      this.streamRecord.push(update);
    }
    const healthy: Pick<QueryState<A, E>, "streamStatus" | "streamError"> = {
      streamStatus: "open",
      streamError: Option.none(),
    };
    const isHealthy = s.streamStatus === "open" && Option.isNone(s.streamError);
    // Without data there is nothing to apply to: the fetch result gets the
    // recorded updates.
    let data = s.data;
    if (Option.isSome(s.data)) {
      const applied = stream.apply(s.data.value, update);
      // Also without structural sharing, an update that changes nothing is none.
      data = applied === s.data.value ? s.data : this.shareData(s.data, applied);
    }
    if (data === s.data) {
      if (!isHealthy) {
        this.patchStream(healthy);
      }
    } else {
      this.showsInitialData = false;
      this.cancelStaleTimer();
      this.patchStream({
        ...healthy,
        data,
        dataUpdatedAt: this.runtime.now(),
        dataUpdateCount: s.dataUpdateCount + 1,
      });
      this.scheduleStaleTimer();
    }
  }

  private onStreamExit(exit: Exit.Exit<void, unknown>): void {
    this.streamFiber = undefined;
    if (this.removed) {
      return;
    }
    // However it ended, updates are missed from here on.
    this.streamLive = false;
    if (Exit.isSuccess(exit)) {
      this.patchStream({ streamStatus: "closed" });
    } else if (Cause.hasDies(exit.cause)) {
      // A defect in the stream or in `apply` is a defect of the query.
      const cause = exit.cause as Cause.Cause<E>;
      this.patchStream({
        streamStatus: "closed",
        status: "error",
        cause: Option.some(cause),
        errorUpdatedAt: this.runtime.now(),
        errorUpdateCount: this.state.errorUpdateCount + 1,
      });
    } else {
      // The retries are used up, or the stream was interrupted from within:
      // from here on this is a query without a stream.
      this.patchStream({
        streamStatus: "closed",
        streamError: Cause.findErrorOption(exit.cause),
      });
    }
    this.syncSnapshot();
  }

  /** Stops the stream. The data misses updates from now on. */
  private stopStream(): void {
    this.interruptStream();
    this.streamStarted = false;
    this.streamLive = false;
    this.streamGap++;
    // Still observed: a definition without a stream took over. From here on
    // this is a plain query, brought up to date once. Without observers the
    // data is only marked stale, and the next mount decides.
    this.snapshotDue = this.isActive;
    // The record stays: a running fetch still needs the updates it holds.
    this.patchStream({ streamStatus: "idle", streamError: Option.none() });
    this.syncSnapshot();
  }

  /**
   * The data misses updates: a hole closed after its snapshot was requested,
   * or one is open (the stream is reconnecting or has ended).
   */
  private get isBehindStream(): boolean {
    return this.coveredGap < this.streamGap || (this.streamStarted && !this.streamLive);
  }

  /**
   * The one place that keeps the data in step with the stream. Called after
   * each stream event and each fetch: marks data that is behind as stale,
   * and fetches a snapshot when that can help.
   */
  private syncSnapshot(context?: Context.Context<any>): void {
    if (
      !this.markBehind() ||
      // While a hole is open, a snapshot would miss the rest of it.
      (this.streamStarted && !this.streamLive) ||
      // No request twice for the same hole, also when it failed.
      this.requestedGap >= this.streamGap ||
      // A running fetch finishes first; its exit comes back here.
      this.state.fetchStatus !== "idle" ||
      !this.mayFetchSnapshot()
    ) {
      return;
    }
    this.fetch(context === undefined ? undefined : { context });
  }

  /** Marks data that is behind the stream as stale. Returns whether it is. */
  private markBehind(): boolean {
    if (this.removed || !this.isBehindStream) {
      return false;
    }
    if (Option.isNone(this.state.data) || this.showsInitialData) {
      // Nothing to bring up to date: loading is up to the observers.
      return false;
    }
    this.invalidate();
    return true;
  }

  /**
   * Data from before the stream started is refetched like on a mount, so
   * `refetchOnMount: false` holds. A hole in a running stream, or its stop,
   * is refetched for any enabled observer.
   */
  private mayFetchSnapshot(): boolean {
    if (this.snapshotDue) {
      return this.isActive && this.options.staleTime !== "static";
    }
    for (const record of this.records) {
      if (
        this.isEnabledFor(record.options) &&
        this.shouldRefetchOn(
          record.options.refetchOnMount ?? this.options.refetchOnMount,
          record.options,
        )
      ) {
        return true;
      }
    }
    return false;
  }

  private interruptStream(): void {
    // Bump first: interrupting runs the fiber's exit handler synchronously.
    this.streamRun++;
    this.streamStopFiber?.interruptUnsafe();
    this.streamStopFiber = undefined;
    this.streamFiber?.interruptUnsafe();
    this.streamFiber = undefined;
  }

  /**
   * A state change made by the stream. It also applies to the state that
   * cancelling the running fetch reverts to, so a cancel keeps it.
   */
  private patchStream(patch: Partial<QueryState<A, E>>): void {
    const revert = this.revertState;
    if (revert !== undefined) {
      this.revertState =
        patch.data === undefined || Option.isSome(revert.data)
          ? { ...revert, ...patch }
          : { ...revert, ...pickStream(patch) };
    }
    this.setState((s) => ({ ...s, ...patch }));
  }

  // -- garbage collection ---------------------------------------------------

  private scheduleGc(): void {
    this.cancelGc();
    if (this.removed || !Duration.isFinite(this.options.gcTime)) {
      return;
    }
    this.gcFiber = this.runtime.runFork(
      Effect.sleep(this.options.gcTime).pipe(
        Effect.andThen(
          Effect.sync(() => {
            this.gcFiber = undefined;
            if (this.records.size === 0 && this.fetchFiber === undefined) {
              this.runtime.remove(this);
            }
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
    if (this.removed) {
      return;
    }
    this.removed = true;
    this.cancelGc();
    this.cancelStaleTimer();
    for (const record of this.records) {
      this.clearInterval(record);
    }
    this.unregisterReactivity?.();
    this.unregisterReactivity = undefined;
    this.interruptStream();
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

const pickStream = <A, E>(
  patch: Partial<QueryState<A, E>>,
): Partial<Pick<QueryState<A, E>, "streamStatus" | "streamError">> => ({
  ...(patch.streamStatus === undefined ? {} : { streamStatus: patch.streamStatus }),
  ...(patch.streamError === undefined ? {} : { streamError: patch.streamError }),
});

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
    streamStatus: state.streamStatus,
    streamError: state.streamError,
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
