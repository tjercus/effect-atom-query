import { type Query, QueryObserver, type QueryResult } from "@effect-native-query/query";
import * as React from "react";
import { adjustOptions, shouldThrow, suspendOn, throwResult } from "./internal.ts";
import { useQueryClient } from "./QueryClientProvider.tsx";
import { useQueryErrorResetBoundary } from "./QueryErrorResetBoundary.tsx";
import type { DefinedUseQueryResult, UseQueryOptions, UseQueryResult } from "./useQuery.ts";

/**
 * A query with per-entry options.
 *
 * @since 0.1.0
 * @category models
 */
export interface QueriesEntry<A, E, B = A> extends UseQueryOptions<A, E, B> {
  readonly query: QueryObserver.Observable<A, E>;
}

/**
 * Build a typed {@link QueriesEntry} (gives `select` a typed parameter).
 *
 * @since 0.1.0
 * @category constructors
 */
export const queriesEntry = <A, E, B = A>(
  query: QueryObserver.Observable<A, E>,
  options?: UseQueryOptions<NoInfer<A>, NoInfer<E>, B>,
): QueriesEntry<A, E, B> => ({ ...options, query });

/**
 * @since 0.1.0
 * @category models
 */
export type QueriesInput = ReadonlyArray<
  QueryObserver.Observable<any, any> | QueriesEntry<any, any, any>
>;

/**
 * @since 0.1.0
 * @category models
 */
export type QueriesResults<Q extends QueriesInput> = {
  readonly [K in keyof Q]: Q[K] extends QueriesEntry<any, infer E, infer B>
    ? UseQueryResult<B, E>
    : Q[K] extends Query.QueryAtom<infer A, infer E, any>
      ? UseQueryResult<A, E>
      : Q[K] extends Query.SkippedQueryAtom<infer A, infer E>
        ? UseQueryResult<A, E>
        : never;
};

/**
 * Results of {@link useSuspenseQueries}: `data` is always present.
 *
 * @since 0.1.0
 * @category models
 */
export type SuspenseQueriesResults<Q extends QueriesInput> = {
  readonly [K in keyof Q]: Q[K] extends QueriesEntry<any, infer E, infer B>
    ? DefinedUseQueryResult<B, E>
    : Q[K] extends Query.QueryAtom<infer A, infer E, any>
      ? DefinedUseQueryResult<A, E>
      : never;
};

const normalize = (
  input: QueriesInput[number],
): QueryObserver.QueriesInput & QueriesEntry<any, any, any> =>
  "query" in input && !("read" in input)
    ? { ...input, options: input }
    : { query: input as QueryObserver.Observable<any, any>, options: {} };

const useBaseQueries = <Q extends QueriesInput, C>(
  options: {
    readonly queries: Q;
    readonly combine?: ((results: QueriesResults<Q>) => C) | undefined;
  },
  suspense: boolean,
): C => {
  const client = useQueryClient();
  const boundary = useQueryErrorResetBoundary();
  const inputs = options.queries.map(normalize).map((input) => ({
    ...input,
    options: adjustOptions(
      input,
      {
        suspense,
        entryStaleTime:
          suspense && !("skipped" in input.query)
            ? client.cache.build(input.query as Query.QueryAtom<any, any, any>).options.staleTime
            : undefined,
      },
      boundary,
    ),
  }));
  const observer = React.useMemo(
    () => new QueryObserver.QueriesObserver(client, inputs),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [client],
  );

  React.useSyncExternalStore(
    React.useCallback((onStoreChange) => observer.subscribe(onStoreChange), [observer]),
    () => observer.version,
    () => observer.version,
  );

  React.useEffect(() => {
    observer.setQueries(inputs);
  });
  React.useEffect(() => {
    boundary.clearReset();
  }, [boundary]);

  const raw = observer.getOptimisticResults(inputs);
  if (suspense && raw.some((result) => result.isPending)) {
    const fibers = observer.fetchOptimistic(inputs);
    if (fibers.length > 0) throw Promise.all(fibers.map(suspendOn));
  }
  raw.forEach((result, i) => {
    if (shouldThrow(result, { suspense, throwOnError: inputs[i]!.throwOnError }, boundary)) {
      throwResult(result);
    }
  });

  // Keep result references stable while nothing changed.
  const cache = React.useRef<{
    raw: ReadonlyArray<QueryResult.QueryResult<any, any>>;
    results: ReadonlyArray<UseQueryResult<any, any>>;
    combine: unknown;
    combined: C;
  } | null>(null);
  const previous = cache.current;
  const sameRaw =
    previous !== null &&
    previous.raw.length === raw.length &&
    previous.raw.every((r, i) => r === raw[i]);
  const results: ReadonlyArray<UseQueryResult<any, any>> = sameRaw
    ? previous.results
    : raw.map((result, i) => ({ ...result, refetch: () => observer.refetch(i) }));
  const combined =
    sameRaw && previous.combine === options.combine
      ? previous.combined
      : options.combine
        ? options.combine(results as unknown as QueriesResults<Q>)
        : (results as unknown as C);
  cache.current = { raw, results, combine: options.combine, combined };
  return combined;
};

/**
 * Observe a dynamic list of queries. `combine` derives one value from all
 * results; it re-runs only when a result changes.
 *
 * ```tsx
 * const todos = useQueries({
 *   queries: ids.map((id) => todoQuery(id)),
 *   combine: (results) => results.flatMap((r) => (r.isSuccess ? [r.data.value] : [])),
 * })
 * ```
 *
 * @since 0.1.0
 * @category hooks
 */
export function useQueries<const Q extends QueriesInput, C = QueriesResults<Q>>(options: {
  readonly queries: Q;
  readonly combine?: ((results: QueriesResults<Q>) => C) | undefined;
}): C {
  return useBaseQueries(options, false);
}

/**
 * Suspense variant of {@link useQueries}: suspends until every query has
 * data, fetching them in parallel.
 *
 * @since 0.1.0
 * @category hooks
 */
export function useSuspenseQueries<
  const Q extends ReadonlyArray<Query.QueryAtom<any, any, any> | QueriesEntry<any, any, any>>,
  C = SuspenseQueriesResults<Q>,
>(options: {
  readonly queries: Q;
  readonly combine?: ((results: SuspenseQueriesResults<Q>) => C) | undefined;
}): C {
  return useBaseQueries(options as never, true);
}
