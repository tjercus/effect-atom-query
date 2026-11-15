import {
  InfiniteQuery,
  type Query,
  type QueryObserver,
  type QueryResult,
} from "@effect-atom-query/query";
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
  const { observer, view, track } = useBaseQuery(query, options, suspense, (result, observer) => ({
    ...result,
    ...pagingOf(query, observer),
  }));
  const fetchNextPage = React.useCallback(() => observer.fetchPage("forward"), [observer]);
  const fetchPreviousPage = React.useCallback(() => observer.fetchPage("backward"), [observer]);
  const refetch = React.useCallback(() => observer.refetch(), [observer]);
  return React.useMemo(
    () => track({ ...view, fetchNextPage, fetchPreviousPage, refetch }),
    [view, fetchNextPage, fetchPreviousPage, refetch, track],
  );
};

const pagingOf = <Page, Param, E, B>(
  query:
    | InfiniteQuery.InfiniteQueryAtom<Page, Param, E, any>
    | Query.SkippedQueryAtom<InfiniteQuery.InfiniteData<Page, Param>, E>,
  observer: QueryObserver.QueryObserver<InfiniteQuery.InfiniteData<Page, Param>, E, B>,
): InfiniteQuery.PagingState => {
  const paging =
    "infinite" in query
      ? InfiniteQuery.pagingState(query.infinite, observer.entryOf(query))
      : InfiniteQuery.pagingState(
          { initialPageParam: undefined, getNextPageParam: () => noPage },
          undefined,
        );
  // Only the flags: keep the view shallowly comparable.
  return {
    hasNextPage: paging.hasNextPage,
    hasPreviousPage: paging.hasPreviousPage,
    isFetchingNextPage: paging.isFetchingNextPage,
    isFetchingPreviousPage: paging.isFetchingPreviousPage,
    isFetchNextPageError: paging.isFetchNextPageError,
    isFetchPreviousPageError: paging.isFetchPreviousPageError,
  };
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
): UseInfiniteQueryResult<NoInfer<B>, E> => usePaging(query, options, false);

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
): UseSuspenseInfiniteQueryResult<NoInfer<B>, E> =>
  usePaging(query, options, true) as UseSuspenseInfiniteQueryResult<B, E>;
