import { type Query, QueryObserver, QueryResult } from "@effect-native-query/query";
import { Cause, Duration, Effect, Fiber, Option } from "effect";
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
}

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

/** Shared by `useQuery`, `useSuspenseQuery` and the infinite variants. */
export const useBaseQuery = <A, E, B>(
  query: QueryObserver.Observable<A, E>,
  options: BaseOptions<A, E, B>,
  suspense: boolean,
): {
  readonly observer: QueryObserver.QueryObserver<A, E, B>;
  readonly result: QueryResult.QueryResult<B, E>;
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
  React.useSyncExternalStore(
    React.useCallback((onStoreChange) => observer.subscribe(onStoreChange), [observer]),
    () => observer.version,
    () => observer.version,
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
  return { observer, result };
};

const isQuery = <A, E>(
  query: QueryObserver.Observable<A, E>,
): query is Query.QueryAtom<A, E, any> => !("skipped" in query);
