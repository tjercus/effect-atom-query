import { Query } from "@effect-atom-query/query";
import { Option } from "effect";
import { useQueryClient } from "./QueryClientProvider.tsx";

/**
 * Start fetching a query during render if it is not in the cache yet, so a
 * child that suspends on it later finds it in flight (avoids waterfalls).
 * Never suspends or throws.
 *
 * @since 0.1.0
 * @category hooks
 */
export const usePrefetchQuery = <A, E, R>(
  query: Query.QueryAtom<A, E, R> | Query.SkippedQueryAtom<A, E>,
): void => {
  const client = useQueryClient();
  if (Query.isQueryAtom(query) && Option.isNone(client.cache.get(query.key))) {
    client.runtime.runFork(client.prefetchQuery(query));
  }
};

/**
 * {@link usePrefetchQuery} for infinite queries (prefetches the first page).
 *
 * @since 0.1.0
 * @category hooks
 */
export const usePrefetchInfiniteQuery: <A, E, R>(
  query: Query.QueryAtom<A, E, R> | Query.SkippedQueryAtom<A, E>,
) => void = usePrefetchQuery;
