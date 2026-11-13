import { InfiniteQuery, type Query, type QueryResult } from "@effect-native-query/query";
import * as React from "react";
import { useBaseQuery } from "./internal.ts";
import type { UseQueryOptions, UseSuspenseQueryOptions } from "./useQuery.ts";

/**
 * @since 0.1.0
 * @category models
 */
export type UseInfiniteQueryResult<B, E> = QueryResult.QueryResult<B, E> &
  InfiniteQuery.PagingState & {
    readonly fetchNextPage: () => void;
    readonly fetchPreviousPage: () => void;
    readonly refetch: () => void;
  };

/**
 * @since 0.1.0
 * @category models
 */
export type UseSuspenseInfiniteQueryResult<B, E> = Query.DefinedQueryResult<B, E> &
  InfiniteQuery.PagingState & {
    readonly fetchNextPage: () => void;
    readonly fetchPreviousPage: () => void;
    readonly refetch: () => void;
  };

const usePaging = <Page, Param, E, B>(
  query:
    | InfiniteQuery.InfiniteQueryAtom<Page, Param, E, any>
    | Query.SkippedQueryAtom<InfiniteQuery.InfiniteData<Page, Param>, E>,
  options: UseQueryOptions<InfiniteQuery.InfiniteData<Page, Param>, E, B>,
  suspense: boolean,
): UseInfiniteQueryResult<B, E> => {
  const { observer, result } = useBaseQuery(query, options, suspense);
  const paging =
    "infinite" in query
      ? InfiniteQuery.pagingState(query.infinite, observer.entryOf(query))
      : InfiniteQuery.pagingState(
          { initialPageParam: undefined, getNextPageParam: () => noPage },
          undefined,
        );
  const fetchNextPage = React.useCallback(() => observer.fetchPage("forward"), [observer]);
  const fetchPreviousPage = React.useCallback(() => observer.fetchPage("backward"), [observer]);
  const refetch = React.useCallback(() => observer.refetch(), [observer]);
  const {
    hasNextPage,
    hasPreviousPage,
    isFetchingNextPage,
    isFetchingPreviousPage,
    isFetchNextPageError,
    isFetchPreviousPageError,
  } = paging;
  return React.useMemo(
    () => ({
      ...result,
      hasNextPage,
      hasPreviousPage,
      isFetchingNextPage,
      isFetchingPreviousPage,
      isFetchNextPageError,
      isFetchPreviousPageError,
      fetchNextPage,
      fetchPreviousPage,
      refetch,
    }),
    [
      result,
      hasNextPage,
      hasPreviousPage,
      isFetchingNextPage,
      isFetchingPreviousPage,
      isFetchNextPageError,
      isFetchPreviousPageError,
      fetchNextPage,
      fetchPreviousPage,
      refetch,
    ],
  );
};

const noPage = { _tag: "None" } as never;

/**
 * Observe an infinite query with paging helpers.
 *
 * ```tsx
 * const feed = useInfiniteQuery(feedQuery("all"))
 * <button disabled={!feed.hasNextPage || feed.isFetchingNextPage} onClick={feed.fetchNextPage}>More</button>
 * ```
 *
 * @since 0.1.0
 * @category hooks
 */
export const useInfiniteQuery = <Page, Param, E, R, B = InfiniteQuery.InfiniteData<Page, Param>>(
  query:
    | InfiniteQuery.InfiniteQueryAtom<Page, Param, E, R>
    | Query.SkippedQueryAtom<InfiniteQuery.InfiniteData<Page, Param>, E>,
  options: UseQueryOptions<NoInfer<InfiniteQuery.InfiniteData<Page, Param>>, NoInfer<E>, B> = {},
): UseInfiniteQueryResult<B, E> => usePaging(query, options, false);

/**
 * Suspense variant of {@link useInfiniteQuery}: suspends for the first page.
 *
 * @since 0.1.0
 * @category hooks
 */
export const useSuspenseInfiniteQuery = <
  Page,
  Param,
  E,
  R,
  B = InfiniteQuery.InfiniteData<Page, Param>,
>(
  query: InfiniteQuery.InfiniteQueryAtom<Page, Param, E, R>,
  options: UseSuspenseQueryOptions<
    NoInfer<InfiniteQuery.InfiniteData<Page, Param>>,
    NoInfer<E>,
    B
  > = {},
): UseSuspenseInfiniteQueryResult<B, E> =>
  usePaging(query, options, true) as UseSuspenseInfiniteQueryResult<B, E>;
