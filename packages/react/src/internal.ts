import { type Query, QueryObserver, QueryResult } from "@effect-atom-query/query";
import { Cause, Duration, Effect, Equal, Fiber, Option } from "effect";
import * as React from "react";
import { useQueryClient } from "./QueryClientProvider.tsx";
import {
  type QueryErrorResetBoundaryValue,
  useQueryErrorResetBoundary,
} from "./QueryErrorResetBoundary.tsx";

/** Declared with method syntax so it is bivariant in `E`. */
export type ThrowOnError<E> = { bivarianceHack(error: E): boolean }["bivarianceHack"];

/** @internal */
export interface BaseOptions<A, E, B> extends QueryObserver.Options<A, B> {
  readonly throwOnError?: boolean | ThrowOnError<E> | undefined;
  readonly notifyOnChangeProps?: NotifyOnChangeProps | undefined;
}

/**
 * Which result properties re-render the component when they change.
 * By default the properties the component reads are tracked; `"all"`
 * re-renders on every change.
 */
export type NotifyOnChangeProps = "all" | ReadonlyArray<string>;

/** Option-aware equality for one result property. */
const samePropValue = (a: unknown, b: unknown): boolean => {
  if (Object.is(a, b)) return true;
  if (Option.isOption(a) && Option.isOption(b)) {
    if (Option.isNone(a) || Option.isNone(b)) return Option.isNone(a) && Option.isNone(b);
    // Values with an `Equal` instance (e.g. `DateTime`) compare by value;
    // plain data relies on structural sharing for referential stability.
    return (
      Object.is(a.value, b.value) || (Equal.isEqual(a.value) && Equal.equals(a.value, b.value))
    );
  }
  return false;
};

const shallowEqual = (a: object, b: object): boolean => {
  const ka = Object.keys(a);
  if (ka.length !== Object.keys(b).length) return false;
  return ka.every((k) => Object.is((a as any)[k], (b as any)[k]));
};

/** The props of `next` that differ from `prev`, restricted to `keys`. */
const changedProps = (prev: object, next: object, keys: Iterable<PropertyKey>): boolean => {
  for (const key of keys) {
    if (!samePropValue((prev as any)[key], (next as any)[key])) return true;
  }
  return false;
};

const promises = new WeakMap<Fiber.Fiber<any, any>, Promise<void>>();

/** A stable promise per fetch fiber, resolving (never rejecting) when it settles. */
export const suspendOn = (fiber: Fiber.Fiber<any, any>): Promise<void> => {
  let promise = promises.get(fiber);
  if (promise === undefined) {
    promise = Effect.runPromise(Effect.asVoid(Fiber.await(fiber)));
    promises.set(fiber, promise);
  }
  return promise;
};

const defectOrError = <B, E>(result: QueryResult.Failure<B, E>): unknown =>
  QueryResult.isDefect(result) ? Cause.squash(result.cause) : Option.getOrThrow(result.error);

const restored = new WeakMap<object, Promise<void>>();

/** A stable promise resolving when the client's persister has finished restoring. */
export const suspendUntilRestored = (restoring: {
  readonly isRestoring: () => boolean;
  readonly subscribe: (listener: () => void) => () => void;
}): Promise<void> => {
  let promise = restored.get(restoring);
  if (promise === undefined) {
    promise = new Promise<void>((resolve) => {
      const unsubscribe = restoring.subscribe(() => {
        if (restoring.isRestoring()) return;
        unsubscribe();
        restored.delete(restoring);
        resolve();
      });
    });
    restored.set(restoring, promise);
  }
  return promise;
};

/** Whether a result should be thrown to the nearest error boundary. */
export const shouldThrow = <B, E>(
  result: QueryResult.QueryResult<B, E>,
  options: {
    readonly suspense: boolean;
    readonly throwOnError?: boolean | ThrowOnError<E> | undefined;
  },
  boundary: QueryErrorResetBoundaryValue,
): result is QueryResult.Failure<B, E> => {
  if (result.status !== "error" || result.isFetching || boundary.isReset()) return false;
  if (QueryResult.isDefect(result)) return true;
  if (options.suspense && Option.isNone(result.data)) return true;
  const error = Option.getOrThrow(result.error);
  const { throwOnError } = options;
  return typeof throwOnError === "function" ? throwOnError(error) : throwOnError === true;
};

export const throwResult = <B, E>(result: QueryResult.Failure<B, E>): never => {
  throw defectOrError(result);
};

/**
 * Observer options adjusted for error boundaries and Suspense:
 * - while a boundary is not reset, errored queries do not refetch on mount;
 * - Suspense queries are fresh for at least 1 second, so the mount right after
 *   suspending does not refetch.
 */
export const adjustOptions = <A, E, B>(
  options: BaseOptions<A, E, B>,
  mode: {
    readonly suspense: boolean;
    readonly entryStaleTime?: Duration.Duration | "static" | undefined;
  },
  boundary: QueryErrorResetBoundaryValue,
): QueryObserver.Options<A, B> => {
  let adjusted: QueryObserver.Options<A, B> = options;
  if ((mode.suspense || options.throwOnError) && !boundary.isReset()) {
    adjusted = { ...adjusted, retryOnMount: false };
  }
  if (mode.suspense && options.staleTime === undefined) {
    const stale = mode.entryStaleTime;
    if (stale !== undefined && stale !== "static" && Duration.toMillis(stale) < 1000) {
      adjusted = { ...adjusted, staleTime: "1 second" };
    }
  }
  return adjusted;
};

/**
 * Shared by `useQuery`, `useSuspenseQuery` and the infinite variants.
 *
 * `derive` maps the observer result to the hook's view (for extra fields such
 * as paging state). The hook re-renders only when a property the component
 * read (through the proxy returned by `track`) changed, unless
 * `notifyOnChangeProps` says otherwise.
 */
export const useBaseQuery = <A, E, B, V extends object = QueryResult.QueryResult<B, E>>(
  query: QueryObserver.Observable<A, E>,
  options: BaseOptions<A, E, B>,
  suspense: boolean,
  derive: (
    result: QueryResult.QueryResult<B, E>,
    observer: QueryObserver.QueryObserver<A, E, B>,
  ) => V = identity as never,
): {
  readonly observer: QueryObserver.QueryObserver<A, E, B>;
  readonly result: QueryResult.QueryResult<B, E>;
  /** `derive(result)`, referentially stable while shallowly equal. */
  readonly view: V;
  /** Wrap the returned object so reads are tracked. */
  readonly track: <T extends object>(value: T) => T;
} => {
  const client = useQueryClient();
  const boundary = useQueryErrorResetBoundary();
  const entryStaleTime =
    suspense && isQuery(query) ? client.cache.build<A, E>(query).options.staleTime : undefined;
  const observerOptions = adjustOptions(options, { suspense, entryStaleTime }, boundary);

  const observer = React.useMemo(
    () => QueryObserver.make<A, E, B>(client, query, observerOptions),
    // A new client means a new observer; query/options changes go through setOptions.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [client],
  );

  // Render tracking state, read by the store subscription between renders.
  const state = React.useRef<TrackingState<A, E, B, V> | null>(null);
  if (state.current === null) {
    state.current = {
      tracked: new Set(),
      view: undefined,
      observedVersion: -1,
      snapshot: 0,
      derive,
      notifyOnChangeProps: undefined,
      recheck: undefined,
    };
  }
  const tracking = state.current;

  React.useSyncExternalStore(
    React.useCallback(
      (onStoreChange) => {
        const check = (force?: boolean) => {
          const t = state.current!;
          if (!force && t.observedVersion === observer.version) return;
          const previous = t.view;
          const next = t.derive(observer.getCurrentResult(), observer);
          const props = t.notifyOnChangeProps;
          const notify =
            previous === undefined ||
            props === "all" ||
            (props === undefined && t.tracked.size === 0) ||
            changedProps(previous, next, props ?? t.tracked);
          t.observedVersion = observer.version;
          if (notify) {
            t.snapshot++;
            onStoreChange();
          }
        };
        const unsubscribe = observer.subscribe(() => check());
        state.current!.recheck = () => check(true);
        // Catch changes between render and subscription.
        check();
        return () => {
          state.current!.recheck = undefined;
          unsubscribe();
        };
      },
      [observer],
    ),
    () => state.current!.snapshot,
    () => state.current!.snapshot,
  );
  React.useEffect(() => {
    observer.setOptions(query, observerOptions);
  });
  React.useEffect(() => {
    boundary.clearReset();
  }, [boundary]);

  const result = observer.getOptimisticResult(query, observerOptions);
  if (suspense && result.isPending && client.runtime.restoring.isRestoring()) {
    throw suspendUntilRestored(client.runtime.restoring);
  }
  if (suspense && result.isPending) {
    const fiber = observer.fetchOptimistic(query, observerOptions);
    if (fiber !== undefined) throw suspendOn(fiber);
  }
  if (shouldThrow(result, { suspense, throwOnError: options.throwOnError }, boundary)) {
    throwResult(result);
  }

  // Throwing to a boundary / suspending depends on these, read or not.
  if (suspense || options.throwOnError) {
    for (const key of throwProps) tracking.tracked.add(key);
  }
  const derived = derive(result, observer);
  const view =
    tracking.view !== undefined && shallowEqual(tracking.view, derived) ? tracking.view : derived;
  // Record what this render showed; the subscription compares against it.
  tracking.view = view;
  tracking.observedVersion = observer.version;
  tracking.derive = derive;
  tracking.notifyOnChangeProps = options.notifyOnChangeProps;

  const track = React.useCallback(
    <T extends object>(value: T): T =>
      new Proxy(value, {
        get(target, key, receiver) {
          const t = state.current!;
          if (!t.tracked.has(key)) {
            t.tracked.add(key);
            // Read for the first time (possibly after render, e.g. in a
            // callback): re-render if it already changed unseen.
            queueMicrotask(() => t.recheck?.());
          }
          return Reflect.get(target, key, receiver);
        },
      }),
    [],
  );
  return { observer, result, view, track };
};

interface TrackingState<A, E, B, V> {
  readonly tracked: Set<PropertyKey>;
  view: V | undefined;
  /** `observer.version` last compared (or rendered). */
  observedVersion: number;
  /** The `useSyncExternalStore` snapshot: bumped when a tracked prop changed. */
  snapshot: number;
  derive: (
    result: QueryResult.QueryResult<B, E>,
    observer: QueryObserver.QueryObserver<A, E, B>,
  ) => V;
  notifyOnChangeProps: NotifyOnChangeProps | undefined;
  /** Compare against the latest result now (set while subscribed). */
  recheck: (() => void) | undefined;
}

const throwProps = ["status", "isFetching", "error", "cause"] as const;

const identity = <T>(t: T): T => t;

const isQuery = <A, E>(
  query: QueryObserver.Observable<A, E>,
): query is Query.QueryAtom<A, E, any> => !("skipped" in query);
