import { type Query, QueryObserver, QueryResult } from "@effect-native-query/query";
import { Cause, Option } from "effect";
import * as React from "react";
import { useQueryClient } from "./QueryClientProvider.tsx";

/**
 * @since 0.1.0
 * @category models
 */
export interface UseQueryOptions<A, E, B = A> extends QueryObserver.Options<A, B> {
  /**
   * Throw typed errors to the nearest error boundary (once no fetch is
   * running). Defects are always thrown.
   */
  readonly throwOnError?: boolean | ThrowOnError<E> | undefined;
}

/**
 * Declared with method syntax so it is bivariant in `E`; lists of differently
 * typed queries (`useQueries`) stay assignable.
 *
 * @since 0.1.0
 * @category models
 */
export type ThrowOnError<E> = { bivarianceHack(error: E): boolean }["bivarianceHack"];

/**
 * @since 0.1.0
 * @category models
 */
export type UseQueryResult<B, E> = QueryResult.QueryResult<B, E> & {
  /** Fire-and-forget refetch. Use `QueryClient` methods for an `Effect`. */
  readonly refetch: () => void;
};

/**
 * @since 0.1.0
 * @category models
 */
export type DefinedUseQueryResult<B, E> = Query.DefinedQueryResult<B, E> & {
  readonly refetch: () => void;
};

/** @internal */
export const throwIfNeeded = <B, E>(
  result: QueryResult.QueryResult<B, E>,
  throwOnError: boolean | ((error: E) => boolean) | undefined,
): void => {
  if (result.status !== "error" || result.isFetching) return;
  if (QueryResult.isDefect(result)) throw Cause.squash(result.cause);
  if (Option.isSome(result.error)) {
    const error = result.error.value;
    if (typeof throwOnError === "function" ? throwOnError(error) : throwOnError === true)
      throw error;
  }
};

/**
 * Subscribe to a query atom with per-component options.
 *
 * - Fetches on mount when data is missing or stale (`refetchOnMount`), once
 *   per mounting component, deduplicated across components.
 * - `select`, `placeholderData` (`Query.keepPreviousData`), `enabled` and
 *   `refetchOnMount` apply to this component only.
 * - Defects are thrown to the nearest error boundary; typed errors only with
 *   `throwOnError`.
 *
 * ```tsx
 * const todo = useQuery(todoQuery(id), { select: (t) => t.title })
 * if (todo.isSuccess) return <h1>{todo.data.value}</h1>
 * ```
 *
 * @since 0.1.0
 * @category hooks
 */
export function useQuery<A, E, R, B = A>(
  query: Query.DefinedQueryAtom<A, E, R>,
  options?: UseQueryOptions<NoInfer<A>, NoInfer<E>, B>,
): DefinedUseQueryResult<B, E>;
export function useQuery<A, E, R, B = A>(
  query: Query.QueryAtom<A, E, R> | Query.SkippedQueryAtom<A, E>,
  options?: UseQueryOptions<NoInfer<A>, NoInfer<E>, B>,
): UseQueryResult<B, E>;
export function useQuery<A, E, B = A>(
  query: QueryObserver.Observable<A, E>,
  options: UseQueryOptions<A, E, B> = {},
): UseQueryResult<B, E> {
  const client = useQueryClient();
  const observer = React.useMemo(
    () => QueryObserver.make<A, E, B>(client, query, options),
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
    observer.setOptions(query, options);
  });

  const result = observer.getOptimisticResult(query, options);
  throwIfNeeded(result, options.throwOnError);

  const refetch = React.useCallback(() => observer.refetch(), [observer]);
  return React.useMemo(() => ({ ...result, refetch }), [result, refetch]);
}
