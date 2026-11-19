import type { Query, QueryObserver, QueryResult } from "@effect-atom-query/query";
import * as React from "react";
import { type NotifyOnChangeProps, type ThrowOnError, useBaseQuery } from "./internal.ts";

export type { NotifyOnChangeProps, ThrowOnError } from "./internal.ts";

/**
 * @since 0.1.0
 * @category models
 */
export interface UseQueryOptions<A, E, B = A> extends QueryObserver.Options<A, B> {
  /**
   * Throw typed errors to the nearest error boundary (once no fetch is
   * running). Defects are always thrown. See `QueryErrorResetBoundary`.
   */
  readonly throwOnError?: boolean | ThrowOnError<E> | undefined;
  /**
   * Re-render only when these result properties change. By default the
   * properties the component reads are tracked automatically; `"all"`
   * re-renders on every change.
   */
  readonly notifyOnChangeProps?: NotifyOnChangeProps | undefined;
}

/**
 * @since 0.1.0
 * @category models
 */
export type UseQueryResult<B, E> = QueryResult.QueryResult<B, E> & {
  /**
   * Fire-and-forget refetch. To wait for it, run
   * `client.refetchQueries({ queryKey, exact: true })` (or `fetchQuery` with
   * `staleTime: 0`, to get the outcome) through `useRunEffect`.
   */
  readonly refetch: () => void;
};

/**
 * @since 0.1.0
 * @category models
 */
export type DefinedUseQueryResult<B, E> = Query.DefinedQueryResult<B, E> & {
  readonly refetch: () => void;
};

/**
 * Subscribe to a query atom with per-component options.
 *
 * - Fetches on mount when data is missing or stale (`refetchOnMount`), once
 *   per mounting component, deduplicated across components.
 * - `select`, `placeholderData` (`Query.keepPreviousData`), `enabled`,
 *   `staleTime`, refetch triggers and polling apply to this component only.
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
): DefinedUseQueryResult<NoInfer<B>, E>;
export function useQuery<A, E, R, B = A>(
  query: Query.QueryAtom<A, E, R> | Query.SkippedQueryAtom<A, E>,
  options?: UseQueryOptions<NoInfer<A>, NoInfer<E>, B>,
): UseQueryResult<NoInfer<B>, E>;
export function useQuery<A, E, B = A>(
  query: QueryObserver.Observable<A, E>,
  options: UseQueryOptions<A, E, B> = {},
): UseQueryResult<B, E> {
  const { observer, view, track } = useBaseQuery(query, options, false);
  const refetch = React.useCallback(() => observer.refetch(), [observer]);
  return React.useMemo(() => track({ ...view, refetch }), [view, refetch, track]);
}

/**
 * @since 0.1.0
 * @category models
 */
export type UseSuspenseQueryOptions<A, E, B = A> = Omit<
  UseQueryOptions<A, E, B>,
  "enabled" | "placeholderData" | "throwOnError"
>;

/**
 * Like {@link useQuery}, but suspends until data is available and throws
 * errors without data to the nearest error boundary, so `data` is always
 * present. Refetch errors (with data) are returned, not thrown.
 *
 * @since 0.1.0
 * @category hooks
 */
export function useSuspenseQuery<A, E, R, B = A>(
  query: Query.QueryAtom<A, E, R>,
  options: UseSuspenseQueryOptions<NoInfer<A>, NoInfer<E>, B> = {},
): DefinedUseQueryResult<NoInfer<B>, E> {
  const { observer, view, track } = useBaseQuery<A, E, B>(query, options, true);
  const refetch = React.useCallback(() => observer.refetch(), [observer]);
  return React.useMemo(
    () => track({ ...view, refetch } as DefinedUseQueryResult<B, E>),
    [view, refetch, track],
  );
}
